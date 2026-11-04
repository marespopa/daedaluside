/**
 * The text index behind live grep. Pure and DOM-free, so it runs unchanged in a Web
 * Worker (`grep.worker.ts`) and in-process (tests, or browsers without workers).
 *
 * Speed comes from never touching disk while the user types: files are decoded once
 * into strings and searched with the engine's native `indexOf`. Line numbers are only
 * computed for hits, and a query that extends the previous one only rescans the files
 * the previous one matched.
 */

export interface GrepHit {
  path: string
  /** 1-based line number. */
  line: number
  /** 0-based column of the match in the full line. */
  col: number
  /** The line, trimmed to a window around the match when very long. */
  text: string
  /** Where `text` starts in the full line, so the match sits at `col - start`. */
  start: number
}

export interface GrepRequest {
  id: number
  query: string
  limit: number
  /** Searched first, so results from open files show up before the rest. */
  priority: readonly string[]
}

export const HIT_LIMIT = 500
const PER_FILE_LIMIT = 100
const WINDOW = 240
const LEAD = 60
/** Searching yields to the event loop this often, so a new keystroke can cancel it. */
const SLICE_MS = 10

interface Doc {
  text: string
  /** `text` lowercased, or the same string when it has no uppercase. Null if lengths differ. */
  lower: string | null
}

function makeDoc(text: string): Doc {
  const lower = text.toLowerCase()
  if (lower === text) return { text, lower: text }
  // A few characters change length when lowercased, which would misalign offsets.
  return { text, lower: lower.length === text.length ? lower : null }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Smart case: an all-lowercase query ignores case, any uppercase makes it exact. */
export function isCaseSensitive(query: string): boolean {
  return query !== query.toLowerCase()
}

export class GrepIndex {
  private docs = new Map<string, Doc>()
  /** Bumped on every change, so cached narrowing never outlives the data. */
  private version = 0
  private last: { query: string; version: number; paths: string[] } | null = null

  get size(): number {
    return this.docs.size
  }

  set(path: string, text: string) {
    this.docs.set(path, makeDoc(text))
    this.version++
  }

  delete(path: string) {
    if (this.docs.delete(path)) this.version++
  }

  clear() {
    this.docs.clear()
    this.version++
    this.last = null
  }

  has(path: string): boolean {
    return this.docs.has(path)
  }

  /** Full text of an indexed file, for previews. */
  text(path: string): string | undefined {
    return this.docs.get(path)?.text
  }

  /** Paths to scan for `query`: the previous result's files when it narrows, else all. */
  private candidates(req: GrepRequest): { paths: string[]; narrowed: boolean } {
    const prev = this.last
    if (
      prev &&
      prev.version === this.version &&
      prev.query !== '' &&
      req.query.startsWith(prev.query)
    )
      return { paths: prev.paths, narrowed: true }
    const rest = new Set(req.priority.filter((p) => this.docs.has(p)))
    const paths = [...rest]
    for (const p of this.docs.keys()) if (!rest.has(p)) paths.push(p)
    return { paths, narrowed: false }
  }

  /**
   * Scans for `req.query`, emitting hits in batches and yielding between slices. Stops
   * early at `req.limit` hits. Returns whether it was cut short (by the limit or a cancel).
   */
  async search(
    req: GrepRequest,
    emit: (hits: GrepHit[]) => void,
    cancelled: () => boolean,
    yieldNow: () => Promise<void> = defaultYield,
  ): Promise<{ truncated: boolean; cancelled: boolean }> {
    const query = req.query
    if (query === '') return { truncated: false, cancelled: false }
    const exact = isCaseSensitive(query)
    const needle = exact ? query : query.toLowerCase()
    const { paths } = this.candidates(req)
    const matched: string[] = []
    let batch: GrepHit[] = []
    let total = 0
    let sliceStart = performance.now()
    let truncated = false
    let stopped = false

    for (const path of paths) {
      // A stale search must stop at once, not at the next slice boundary.
      if (cancelled()) {
        stopped = true
        break
      }
      const doc = this.docs.get(path)
      if (!doc) continue
      const hits = scanDoc(path, doc, needle, exact, Math.min(PER_FILE_LIMIT, req.limit - total))
      if (hits.length > 0) {
        matched.push(path)
        batch.push(...hits)
        total += hits.length
        if (total >= req.limit) {
          truncated = true
          break
        }
      }
      if (performance.now() - sliceStart >= SLICE_MS) {
        if (batch.length > 0) {
          emit(batch)
          batch = []
        }
        await yieldNow()
        if (cancelled()) {
          stopped = true
          break
        }
        sliceStart = performance.now()
      }
    }
    if (batch.length > 0 && !stopped) emit(batch)
    // Only a complete scan can narrow the next query: a truncated one skipped files.
    if (!truncated && !stopped)
      this.last = { query, version: this.version, paths: matched }
    else this.last = null
    return { truncated, cancelled: stopped }
  }
}

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0))

function scanDoc(
  path: string,
  doc: Doc,
  needle: string,
  exact: boolean,
  max: number,
): GrepHit[] {
  const out: GrepHit[] = []
  if (max <= 0) return out
  const { text } = doc
  const hay = exact ? text : doc.lower
  if (hay === null) return scanSlow(path, text, needle, max)
  let from = 0
  let line = 1
  let counted = 0 // newlines are counted up to this offset
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at === -1) break
    // Lines containing a hit are reported once; count newlines only up to the hit.
    for (let nl = text.indexOf('\n', counted); nl !== -1 && nl < at; nl = text.indexOf('\n', counted)) {
      line++
      counted = nl + 1
    }
    const lineStart = text.lastIndexOf('\n', at - 1) + 1
    let lineEnd = text.indexOf('\n', at)
    if (lineEnd === -1) lineEnd = text.length
    out.push(hit(path, line, text, lineStart, lineEnd, at - lineStart))
    if (out.length >= max) break
    from = lineEnd + 1
  }
  return out
}

/** Case-insensitive fallback for the rare file whose lowercase form changes length. */
function scanSlow(path: string, text: string, needle: string, max: number): GrepHit[] {
  const out: GrepHit[] = []
  const re = new RegExp(escapeRe(needle), 'gi')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const m = re.exec(lines[i]!)
    re.lastIndex = 0
    if (m) out.push(hit(path, i + 1, lines[i]!, 0, lines[i]!.length, m.index))
  }
  return out
}

function hit(
  path: string,
  line: number,
  text: string,
  lineStart: number,
  lineEnd: number,
  col: number,
): GrepHit {
  const len = lineEnd - lineStart
  // Drop a CR left by CRLF files.
  const end = text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd
  if (len <= WINDOW) return { path, line, col, text: text.slice(lineStart, end), start: 0 }
  const start = Math.max(0, col - LEAD)
  return {
    path,
    line,
    col,
    text: text.slice(lineStart + start, Math.min(end, lineStart + start + WINDOW)),
    start,
  }
}

// ---- which files are worth indexing ----------------------------------------

export const MAX_FILE_BYTES = 1024 * 1024
/** Total decoded text kept in memory; past this the index is partial. */
export const MAX_INDEX_BYTES = 200 * 1024 * 1024

const BINARY_EXT = new Set(
  (
    'png jpg jpeg gif webp bmp ico svgz avif heic tiff psd ' +
    'zip gz tgz bz2 xz 7z rar jar war ' +
    'pdf doc docx xls xlsx ppt pptx ' +
    'exe dll so dylib bin o a class wasm pyc ' +
    'mp3 mp4 mov avi mkv webm flac wav ogg m4a ' +
    'woff woff2 ttf otf eot ' +
    'sqlite db lock map'
  ).split(' '),
)

/** Cheap, name-and-size-only filter. Content is checked separately for NUL bytes. */
export function shouldIndex(path: string, size: number | undefined): boolean {
  if (size !== undefined && (size === 0 || size > MAX_FILE_BYTES)) return false
  const dot = path.lastIndexOf('.')
  if (dot > path.lastIndexOf('/')) {
    const ext = path.slice(dot + 1).toLowerCase()
    if (BINARY_EXT.has(ext) || ext === 'svg') return false
  }
  return true
}

export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0)
}
