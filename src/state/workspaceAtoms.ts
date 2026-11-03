import { atom } from 'jotai'
import type { WorkspaceMeta } from '../workspace/manager'
import type { Entry } from '../workspace/types'

export interface OpenBuffer {
  path: string
  /** Pinned tabs sit first in the strip and show as a compact icon. */
  pinned: boolean
  dirty: boolean
  /** Last save failed; the buffer stays dirty and will be retried. */
  saveError: boolean
}

export type WorkspaceStatus =
  | { state: 'loading' }
  | { state: 'ready'; backend: 'opfs' | 'idb' }
  | { state: 'error'; message: string }

/**
 * What the last session looked like, saved in localStorage so the first paint can
 * show the same names while storage starts. Paths and names only, never contents.
 */
export interface SessionSnapshot {
  workspaceId: string
  name: string
  tree: { path: string; kind: 'file' | 'dir' }[]
  openFiles: string[]
  activeFile: string | null
}

/**
 * A folder or zip being read and copied in. `total` is null while still scanning
 * or unpacking, when the item count is not known yet.
 */
export interface ImportStatus {
  name: string
  done: number
  total: number | null
}

export const workspaceStatusAtom = atom<WorkspaceStatus>({ state: 'loading' })
/** Set for the whole import, from picking the folder until its first file is open. */
export const importStatusAtom = atom<ImportStatus | null>(null)
/** Null when there is no saved session. Only read while the status is `loading`. */
export const snapshotAtom = atom<SessionSnapshot | null>(null)
export const workspacesAtom = atom<WorkspaceMeta[]>([])
export const currentWorkspaceIdAtom = atom<string | null>(null)
/** Every entry of the current workspace, flat; the tree UI derives hierarchy from paths. */
export const treeAtom = atom<Entry[]>([])
/** Paths of the current workspace that are still being copied in. They are listed but not readable yet. */
export const pendingPathsAtom = atom<ReadonlySet<string>>(new Set<string>())
/** Background copy of the current workspace; null when nothing is copying. */
export const copyStatusAtom = atom<{
  done: number
  failed: number
  total: number
} | null>(null)
export const openBuffersAtom = atom<OpenBuffer[]>([])
export const activePathAtom = atom<string | null>(null)
export const sidebarOpenAtom = atom(false)
/**
 * Asks the file tree to start a new file or folder in the selected folder. Set by the
 * header buttons, which also open the tree; the tree clears it once it has started.
 */
export const newEntryRequestAtom = atom<{ kind: 'new-file' | 'new-folder' } | null>(null)
export const settingsOpenAtom = atom(false)
/** Transient message (errors, import results). */
export const noticeAtom = atom<{ kind: 'info' | 'error'; text: string } | null>(null)
