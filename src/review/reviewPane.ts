import { EditorView } from '@codemirror/view'
import { getCM } from '@replit/codemirror-vim'
import type { Hunk } from './diff'

/**
 * Git actions on the hunk at the cursor (or the whole file when the cursor is on none).
 * `stage` toggles; `put` only stages (dp); `obtain` and `revert` both restore HEAD's text (do, X, u).
 */
export type ReviewAction = 'stage' | 'put' | 'obtain' | 'revert'

/** What Vim commands may ask of the open review pane. */
export interface ReviewPane {
  /** The view that holds the cursor: the working-tree side. */
  view: EditorView
  /** Runs a git action on the hunk under the cursor. */
  act(action: ReviewAction): void
  /** Moves the cursor `delta` hunks (wrapping at the ends) and keeps the active hunk in sync. */
  jump(delta: number): void
  /** 0-based line of the first or last hunk, or null when the file has no hunks. */
  edge(which: 'first' | 'last'): number | null
}

let pane: ReviewPane | null = null

/** DiffReview registers itself while mounted; null clears it. */
export function setReviewPane(next: ReviewPane | null) {
  pane = next
}

export function getReviewPane(): ReviewPane | null {
  return pane
}

/** True when `view` is the review pane's editor. */
export function isReviewView(view: EditorView): boolean {
  return pane !== null && pane.view === view
}

/** Index of the hunk to move to from `line`, stepping `delta` hunks over sorted anchor lines; wraps. */
export function stepHunk(lines: readonly number[], line: number, delta: number): number {
  const n = lines.length
  if (n === 0) return -1
  let at: number
  if (delta > 0) {
    // First anchor strictly after the cursor, then the remaining steps.
    const next = lines.findIndex((l) => l > line)
    at = (next === -1 ? 0 : next) + (delta - 1)
  } else {
    let prev = -1
    for (let i = 0; i < n; i++) if (lines[i]! < line) prev = i
    at = (prev === -1 ? n - 1 : prev) + (delta + 1)
  }
  return ((at % n) + n) % n
}

/** 1-based line each hunk is reached at: its first new line, or the line after a deletion. */
export function hunkAnchors(hunks: readonly Hunk[], lineCount: number): number[] {
  return hunks.map((h) => Math.min(h.newRange.start + 1, Math.max(lineCount, 1)))
}

/**
 * Single-key review mappings. They live on the review view itself rather than in the
 * global Vim registry, because `s`, `X`, `u` and <Space> mean something else in the
 * main editor. They bypass Vim, so they work with Vim mode off too, and yield to a
 * pending count, operator, visual selection or `:` line.
 */
export const reviewKeys = EditorView.domEventHandlers({
  keydown(e, view) {
    if (!isReviewView(view) || e.ctrlKey || e.metaKey || e.altKey) return false
    const action: ReviewAction | null =
      e.key === 's' || e.key === ' '
        ? 'stage'
        : e.key === 'X' || e.key === 'u'
          ? 'revert'
          : null
    if (action === null) return false
    const vs = getCM(view)?.state.vim
    const busy =
      !!getCM(view)?.state.dialog ||
      !!vs?.visualMode ||
      !!vs?.insertMode ||
      !!vs?.inputState?.operator ||
      (vs?.inputState?.keyBuffer?.length ?? 0) > 0
    if (busy) return false
    e.preventDefault()
    getReviewPane()?.act(action)
    return true
  },
})
