import { computeHunks, type Hunk, type LineRange } from './diff'

/** Lines of a text with their terminators kept; the count matches `splitLines`. */
function keepLines(text: string): string[] {
  return text === '' ? [] : (text.match(/[^\n]*\n|[^\n]+$/g) ?? [])
}

/**
 * `target` with its lines `tr` replaced by lines `sr` of `source`. Only the last line may
 * end without a newline, so inserting after an unterminated last line terminates it.
 */
export function replaceLines(
  target: string,
  tr: LineRange,
  source: string,
  sr: LineRange,
): string {
  const t = keepLines(target)
  const out = [
    ...t.slice(0, tr.start),
    ...keepLines(source).slice(sr.start, sr.start + sr.count),
    ...t.slice(tr.start + tr.count),
  ]
  for (let i = 0; i < out.length - 1; i++) if (!out[i]!.endsWith('\n')) out[i] += '\n'
  return out.join('')
}

/** Ranges overlap or touch; gaps (count 0) match the lines on either side of them. */
export function rangesTouch(a: LineRange, b: LineRange): boolean {
  return a.start <= b.start + b.count && b.start <= a.start + a.count
}

export function sameHunk(a: Hunk, b: Hunk): boolean {
  return (
    a.kind === b.kind &&
    a.baseRange.start === b.baseRange.start &&
    a.baseRange.count === b.baseRange.count &&
    a.newRange.start === b.newRange.start &&
    a.newRange.count === b.newRange.count
  )
}

/** The text of the index after staging `hunk` (a HEAD to working-tree hunk), or null when it is already staged. */
export function stageHunkText(index: string, work: string, hunk: Hunk): string | null {
  const hunks = computeHunks(index, work)
    .filter((h) => rangesTouch(h.newRange, hunk.newRange))
    .sort((a, b) => b.baseRange.start - a.baseRange.start)
  if (hunks.length === 0) return null
  let out = index
  for (const h of hunks) out = replaceLines(out, h.baseRange, work, h.newRange)
  return out
}

/** The text of the index after unstaging `hunk`, or null when HEAD and the index agree there. */
export function unstageHunkText(head: string, index: string, hunk: Hunk): string | null {
  const hunks = computeHunks(head, index)
    .filter((h) => rangesTouch(h.baseRange, hunk.baseRange))
    .sort((a, b) => b.newRange.start - a.newRange.start)
  if (hunks.length === 0) return null
  let out = index
  for (const h of hunks) out = replaceLines(out, h.newRange, head, h.baseRange)
  return out
}

/** `work` with `hunk` reverted to its HEAD text. */
export function revertHunkText(head: string, work: string, hunk: Hunk): string {
  return replaceLines(work, hunk.newRange, head, hunk.baseRange)
}

/** The smallest single edit that turns `from` into `to`, for dispatching into a document. */
export function minimalChange(
  from: string,
  to: string,
): { from: number; to: number; insert: string } {
  let p = 0
  const max = Math.min(from.length, to.length)
  while (p < max && from.charCodeAt(p) === to.charCodeAt(p)) p++
  let s = 0
  while (
    s < max - p &&
    from.charCodeAt(from.length - 1 - s) === to.charCodeAt(to.length - 1 - s)
  )
    s++
  return { from: p, to: from.length - s, insert: to.slice(p, to.length - s) }
}
