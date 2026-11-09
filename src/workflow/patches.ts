import type { FilePatch } from './types'

export class PatchError extends Error {
  readonly path: string | undefined
  constructor(message: string, path?: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'PatchError'
    this.path = path
  }
}

interface Edit {
  search: string
  replace: string
}
export interface RawPatch {
  path: string
  edits: Edit[]
}

const FILE_LINE = /^\s*(?:\*\*)?FILE:\s*`?(.+?)`?(?:\*\*)?\s*$/i
const SEARCH = '<<<<<<< SEARCH'
const DIVIDER = '======='
const REPLACE = '>>>>>>> REPLACE'

/** Reads the SEARCH/REPLACE format from model output. Anything outside a block, such as fences, is ignored. */
export function parsePatches(text: string): RawPatch[] {
  const byPath = new Map<string, RawPatch>()
  let path: string | null = null
  let mode: 'out' | 'search' | 'replace' = 'out'
  let search: string[] = []
  let replace: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (mode === 'out') {
      const m = FILE_LINE.exec(line)
      if (m) path = m[1]!.trim()
      else if (t === SEARCH) {
        if (!path) throw new PatchError('Edit block before any FILE: line')
        mode = 'search'
        search = []
        replace = []
      }
    } else if (mode === 'search') {
      if (t === DIVIDER) mode = 'replace'
      else search.push(line)
    } else if (t === REPLACE) {
      const patch = byPath.get(path!) ?? { path: path!, edits: [] }
      patch.edits.push({ search: search.join('\n'), replace: replace.join('\n') })
      byPath.set(path!, patch)
      mode = 'out'
    } else {
      replace.push(line)
    }
  }
  if (mode !== 'out')
    throw new PatchError(
      'Edit block was not closed; the reply may have been cut off',
      path ?? undefined,
    )
  return [...byPath.values()]
}

/** A workspace-relative path with no way out of the workspace and no touching `.git`. */
export function checkPath(path: string): string {
  const p = path.replace(/^\.\//, '')
  const bad =
    !p ||
    p.startsWith('/') ||
    p.includes('\\') ||
    p.includes('\0') ||
    /^[a-z]:/i.test(p) ||
    p
      .split('/')
      .some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git')
  if (bad) throw new PatchError('Path is not allowed', path)
  return p
}

function count(haystack: string, needle: string): number {
  let n = 0
  for (
    let i = haystack.indexOf(needle);
    i >= 0;
    i = haystack.indexOf(needle, i + needle.length)
  )
    n++
  return n
}

/**
 * Applies the edits to the current files. `read` returns null for a missing file. Every SEARCH must
 * match exactly once, so a stale or ambiguous edit fails instead of landing in the wrong place.
 */
export async function resolvePatches(
  raw: RawPatch[],
  read: (path: string) => Promise<string | null>,
): Promise<FilePatch[]> {
  const out: FilePatch[] = []
  for (const r of raw) {
    const path = checkPath(r.path)
    const base = await read(path)
    const crlf = base?.includes('\r\n') ?? false
    let text = base === null ? null : base.replace(/\r\n/g, '\n')
    for (const e of r.edits) {
      if (e.search.trim() === '') {
        if (text !== null)
          throw new PatchError('File already exists; use SEARCH text to edit it', path)
        text = e.replace.endsWith('\n') || e.replace === '' ? e.replace : e.replace + '\n'
        continue
      }
      if (text === null) throw new PatchError('File does not exist', path)
      const n = count(text, e.search)
      if (n === 0)
        throw new PatchError('SEARCH text was not found; the file may have changed', path)
      if (n > 1)
        throw new PatchError(`SEARCH text matches ${n} places; it must match one`, path)
      const i = text.indexOf(e.search)
      text = text.slice(0, i) + e.replace + text.slice(i + e.search.length)
    }
    const content = crlf && text !== null ? text.replace(/\n/g, '\r\n') : (text ?? '')
    if (content !== base) out.push({ path, base, content })
  }
  if (out.length === 0) throw new PatchError('The reply contained no changes')
  return out
}
