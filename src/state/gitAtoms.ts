import { atom } from 'jotai'
import type { Hunk } from '../review/diff'

export type GitStatus = 'modified' | 'added' | 'deleted' | 'untracked'

/** Bumped whenever HEAD or the status map is re-read; `status` maps changed paths to how they differ from HEAD. */
export const gitHeadAtom = atom<{ version: number; status: ReadonlyMap<string, GitStatus> }>({
  version: 0,
  status: new Map(),
})
/** Hunks of each diffed file against HEAD, keyed by workspace path. */
export const fileDiffMapAtom = atom<ReadonlyMap<string, readonly Hunk[]>>(new Map())
/** Index of the hunk under review in the active file; -1 when none is selected. */
export const activeHunkIndexAtom = atom(-1)
/** The diff review overlay replaces the editor while true. */
export const reviewOpenAtom = atom(false)
export type ReviewLayout = 'unified' | 'split'
/** Layout the review was asked for; split shows the unified view until it exists. */
export const reviewLayoutAtom = atom<ReviewLayout>('unified')
