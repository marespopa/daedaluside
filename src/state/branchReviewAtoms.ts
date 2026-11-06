import { atom } from 'jotai'
import type { Marks } from '../review/branch/marks'
import type { BranchFile } from '../workspace/gitService'

export type BranchFocus = 'index' | 'canvas'

/** `base`: merge-base with the base branch to the working tree. `working`: HEAD to the working tree. */
export type BranchMode = 'base' | 'working'

export interface BranchReviewState {
  mode: BranchMode
  /** The base as the user named it (`main`, `origin/dev`). */
  base: string
  branch: string
  status: 'loading' | 'ready' | 'error'
  message: string | null
  mergeBase: string | null
  head: string | null
  files: readonly BranchFile[]
  index: number
  focus: BranchFocus
  /** True while the file list is only the committed changes and the working tree is still being read. */
  partial?: boolean
}

/**
 * Line totals per path, filled in the background (absent until computed), and whether every
 * file's are in so the header total is final. Kept apart from the review so that each patch
 * as totals stream in re-renders only the header total, not the file list.
 */
export interface BranchStats {
  stats: Readonly<Record<string, { add: number; del: number }>>
  done: boolean
}
export const branchStatsAtom = atom<BranchStats>({ stats: {}, done: false })

/** Null while the branch review surface is closed. */
export const branchReviewAtom = atom<BranchReviewState | null>(null)
/** True while the Branch Review tab (not a file tab) is the focused one. */
export const branchTabActiveAtom = atom(false)
/** Reviewed files of the open branch review (validated against blob oids). */
export const branchMarksAtom = atom<Marks>({})
/** Hunks approved with `sa` this session, as `path#baseStart:newStart`. */
export const branchApprovedAtom = atom<ReadonlySet<string>>(new Set<string>())
/** A destructive action waiting for y / n. */
export const branchConfirmAtom = atom<{ kind: 'file' | 'hunk'; path: string } | null>(
  null,
)
