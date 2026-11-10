import { atom } from 'jotai'
import type { Hunk } from '../review/diff'

export type GitStatus = 'modified' | 'added' | 'deleted' | 'untracked'

/** Bumped whenever HEAD or the status map is re-read; `status` maps changed paths to how they differ from HEAD. */
export const gitHeadAtom = atom<{
  version: number
  status: ReadonlyMap<string, GitStatus>
}>({
  version: 0,
  status: new Map(),
})
/** Checked-out branch of the open folder ("HEAD" when detached); null when not a repo or unread. */
export const gitBranchAtom = atom<string | null>(null)
/** The branch being checked out, set the moment a switch starts so the UI can show it; null otherwise. */
export const branchSwitchAtom = atom<string | null>(null)
/** True when the open folder has a `.git` entry: a branch name is on its way. */
export const gitRepoAtom = atom(false)
/** True once the default-base branch review has been read in the background, so opening it is instant. */
export const branchPrefetchReadyAtom = atom(false)
/** Files the default-base review changes, once the background read has them; null before that or on failure. */
export const branchPrefetchCountAtom = atom<number | null>(null)
/** Per-file diffs against HEAD (gutter marks, +/- stats) are computed only while this is on; off by default. */
export const fileDiffEnabledAtom = atom(false)
/** Hunks of each diffed file against HEAD, keyed by workspace path. */
export const fileDiffMapAtom = atom<ReadonlyMap<string, readonly Hunk[]>>(new Map())
/** Index of the hunk under review in the active file; -1 when none is selected. */
export const activeHunkIndexAtom = atom(-1)
/** The diff review overlay replaces the editor while true. */
export const reviewOpenAtom = atom(false)
export type ReviewLayout = 'unified' | 'split'
/** Layout the review was asked for; split shows the unified view until it exists. */
export const reviewLayoutAtom = atom<ReviewLayout>('unified')
