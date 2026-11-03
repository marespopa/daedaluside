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
  | { state: 'ready'; backend: 'idb' }
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
/** Paths currently being deleted from the workspace. Tree actions stay disabled while non-empty. */
export const deletingPathsAtom = atom<ReadonlySet<string>>(new Set<string>())
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
/**
 * The folder the current workspace writes through to. `paused` means the browser no longer
 * grants write access (after a reload, or the user revoked it); the tree offers Reconnect.
 */
export const linkedFolderAtom = atom<{ name: string; paused: boolean } | null>(null)
/**
 * Whether the reconnect dialog is showing. Set when the linked folder is paused (on open,
 * or after a failed write). "Later" clears it until the next open or failed write.
 */
export const reconnectPromptAtom = atom(false)

export const sidebarOpenAtom = atom(false)
/** Incremented to put keyboard focus on the tree's selected row after it opens. */
export const fileTreeFocusAtom = atom(0)
export const settingsOpenAtom = atom(false)
/** Transient message (errors, import results). */
export const noticeAtom = atom<{ kind: 'info' | 'error'; text: string } | null>(null)
