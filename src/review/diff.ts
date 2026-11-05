import { diffArrays } from 'diff'

export type HunkKind = 'add' | 'change' | 'remove'

/** A run of whole lines: `start` is 0-based, `count` may be 0 (the position of a gap). */
export interface LineRange {
  start: number
  count: number
}

export interface Hunk {
  kind: HunkKind
  /** Lines in the HEAD text. */
  baseRange: LineRange
  /** Lines in the current text. For `remove`, `count` is 0 and `start` is the line after the gap. */
  newRange: LineRange
}

export interface DiffStats {
  added: number
  removed: number
  hunks: number
}

/** Lines of a text; a final newline does not start an extra empty line. CRLF counts as LF. */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
}

/** Folds `diffArrays` parts into hunks; offsets place a sub-range inside the whole file. */
function foldParts(
  parts: readonly {
    count?: number | undefined
    value: string[]
    added?: boolean | undefined
    removed?: boolean | undefined
  }[],
  aOff: number,
  bOff: number,
): Hunk[] {
  const hunks: Hunk[] = []
  let ai = aOff
  let bi = bOff
  let removed = 0
  let added = 0
  let aStart = 0
  let bStart = 0
  const flush = () => {
    if (removed === 0 && added === 0) return
    hunks.push({
      kind: removed === 0 ? 'add' : added === 0 ? 'remove' : 'change',
      baseRange: { start: aStart, count: removed },
      newRange: { start: bStart, count: added },
    })
    removed = added = 0
  }
  for (const part of parts) {
    const n = part.count ?? part.value.length
    if (part.removed || part.added) {
      if (removed === 0 && added === 0) {
        aStart = ai
        bStart = bi
      }
      if (part.removed) {
        removed += n
        ai += n
      } else {
        added += n
        bi += n
      }
    } else {
      flush()
      ai += n
      bi += n
    }
  }
  flush()
  return hunks
}

/** Above this many lines (either side) a diff is split at anchor lines instead of run whole. */
export const CHUNKED_DIFF_LINES = 4000

/**
 * Lines that occur exactly once on each side, in an order both sides agree on (the
 * longest increasing run of their positions). They are equal, so the diff can be cut
 * at them and each piece solved on its own.
 */
function anchorLines(
  a: string[],
  aLo: number,
  aHi: number,
  b: string[],
  bLo: number,
  bHi: number,
): [number, number][] {
  const seen = new Map<string, { ai: number; na: number; bi: number; nb: number }>()
  for (let i = aLo; i < aHi; i++) {
    const e = seen.get(a[i]!)
    if (e) e.na++
    else seen.set(a[i]!, { ai: i, na: 1, bi: -1, nb: 0 })
  }
  for (let j = bLo; j < bHi; j++) {
    const e = seen.get(b[j]!)
    if (e) {
      e.nb++
      e.bi = j
    }
  }
  const pairs: [number, number][] = []
  for (const e of seen.values()) if (e.na === 1 && e.nb === 1) pairs.push([e.ai, e.bi])
  pairs.sort((x, y) => x[0] - y[0])
  // Longest increasing subsequence of the b positions.
  const tails: number[] = []
  const prev: number[] = new Array<number>(pairs.length).fill(-1)
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tails[mid]!]![1] < pairs[i]![1]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]!
    tails[lo] = i
  }
  const out: [number, number][] = []
  for (let k = tails.length > 0 ? tails[tails.length - 1]! : -1; k >= 0; k = prev[k]!) {
    out.push(pairs[k]!)
  }
  return out.reverse()
}

/**
 * The hunks of `a` against `b`, a piece at a time in document order: the common head and
 * tail are trimmed, the rest is cut at anchor lines, and each piece is diffed alone.
 * Hunks never span an anchor, so the pieces concatenate into the full result. Callers
 * that want to stay responsive can pause between pieces.
 */
export function* hunkPieces(a: string[], b: string[]): Generator<Hunk[]> {
  let lo = 0
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++
  let aHi = a.length
  let bHi = b.length
  while (aHi > lo && bHi > lo && a[aHi - 1] === b[bHi - 1]) {
    aHi--
    bHi--
  }
  let pa = lo
  let pb = lo
  for (const [ai, bi] of [
    ...anchorLines(a, lo, aHi, b, lo, bHi),
    [aHi, bHi] as [number, number],
  ]) {
    if (ai > pa || bi > pb) {
      const hunks = foldParts(diffArrays(a.slice(pa, ai), b.slice(pb, bi)), pa, pb)
      if (hunks.length > 0) yield hunks
    }
    pa = ai + 1
    pb = bi + 1
  }
}

/** Line-level diff of `base` against `current`, as hunks in document order. */
export function computeHunks(base: string, current: string): Hunk[] {
  const a = splitLines(base)
  const b = splitLines(current)
  if (a.length > CHUNKED_DIFF_LINES || b.length > CHUNKED_DIFF_LINES) {
    return [...hunkPieces(a, b)].flat()
  }
  return foldParts(diffArrays(a, b), 0, 0)
}

/**
 * Like `computeHunks`, but hands the hunks over as they are found and gives the thread
 * back between pieces (at most every `sliceMs`), so a huge file neither blocks a worker
 * from hearing a cancel nor makes the caller wait for the whole diff. Resolves false
 * when `cancelled()` stopped it.
 */
export async function streamHunks(
  base: string,
  current: string,
  emit: (hunks: Hunk[]) => void,
  cancelled: () => boolean,
  sliceMs = 16,
): Promise<boolean> {
  let batch: Hunk[] = []
  let sliceStart = Date.now()
  for (const hunks of hunkPieces(splitLines(base), splitLines(current))) {
    if (cancelled()) return false
    batch.push(...hunks)
    if (Date.now() - sliceStart >= sliceMs) {
      emit(batch)
      batch = []
      await new Promise<void>((r) => setTimeout(r, 0))
      if (cancelled()) return false
      sliceStart = Date.now()
    }
  }
  if (cancelled()) return false
  if (batch.length > 0) emit(batch)
  return true
}

export function hunkStats(hunks: readonly Hunk[]): DiffStats {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    added += h.newRange.count
    removed += h.baseRange.count
  }
  return { added, removed, hunks: hunks.length }
}

export interface DiffResult {
  hunks: Hunk[]
  stats: DiffStats
}

export function diffTexts(base: string, current: string): DiffResult {
  const hunks = computeHunks(base, current)
  return { hunks, stats: hunkStats(hunks) }
}
