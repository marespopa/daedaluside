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

/** Line-level Myers diff of `base` against `current`, as hunks in document order. */
export function computeHunks(base: string, current: string): Hunk[] {
  const a = splitLines(base)
  const b = splitLines(current)
  const hunks: Hunk[] = []
  let ai = 0
  let bi = 0
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
  for (const part of diffArrays(a, b)) {
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
