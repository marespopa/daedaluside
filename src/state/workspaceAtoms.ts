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
  { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string }

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

export const workspaceStatusAtom = atom<WorkspaceStatus>({ state: 'loading' })
/** Null when there is no saved session. Only read while the status is `loading`. */
export const snapshotAtom = atom<SessionSnapshot | null>(null)
export const workspacesAtom = atom<WorkspaceMeta[]>([])
export const currentWorkspaceIdAtom = atom<string | null>(null)
/** Every entry of the current workspace, flat; the tree UI derives hierarchy from paths. */
export const treeAtom = atom<Entry[]>([])
/**
 * Folders whose children are in `treeAtom`. A folder opens with only its root listed;
 * the rest is read when a folder is expanded (or all at once, see `treeCompleteAtom`).
 */
export const loadedDirsAtom = atom<ReadonlySet<string>>(new Set<string>())
/** True once every folder has been read, so `treeAtom` is the whole workspace. */
export const treeCompleteAtom = atom(false)

/**
 * State of the current workspace's tree, separate from storage startup (that is
 * `workspaceStatusAtom`). `no-folder` means no workspace is linked at all; the
 * tree asks for a folder instead of pretending the folder is empty.
 */
export type TreeStatus =
  | { state: 'no-folder' }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'permission' }
  | { state: 'error'; message: string }

export const treeStatusAtom = atom<TreeStatus>({ state: 'no-folder' })
/**
 * Progress of a full folder read: entries found so far and, when a previous read of
 * the same workspace knew it, the expected total. Null unless the tree is loading.
 */
export const treeProgressAtom = atom<{
  done: number
  total: number | null
  startedAt?: number
} | null>(null)
/** Paths currently being deleted from the workspace. Tree actions stay disabled while non-empty. */
export const deletingPathsAtom = atom<ReadonlySet<string>>(new Set<string>())
export const openBuffersAtom = atom<OpenBuffer[]>([])
export const activePathAtom = atom<string | null>(null)
/** A file that was just clicked and is still being read: the UI shows it as opening. */
export const openingPathAtom = atom<string | null>(null)
/**
 * The folder the current workspace reads and writes through. `paused` means the browser
 * no longer grants readwrite access (after a reload, or the user revoked it); the tree
 * offers Reconnect.
 */
export const linkedFolderAtom = atom<{
  name: string
  paused: boolean
  single?: boolean
} | null>(null)
/**
 * Whether the reconnect dialog is showing. Set when the linked folder is paused (on open,
 * or after a failed write). "Later" clears it until the next open or failed write.
 */
export const reconnectPromptAtom = atom(false)

export const sidebarOpenAtom = atom(false)
/** PRD-named aliases. The tree is a flat list; files are keyed by path. */
export const workspaceTreeAtom = treeAtom
export const activeFileIdAtom = activePathAtom
/** Incremented to put keyboard focus on the tree's selected row after it opens. */
export const fileTreeFocusAtom = atom(0)
export const settingsOpenAtom = atom(false)
/** Transient message (errors, import results). */
export const noticeAtom = atom<{ kind: 'info' | 'error'; text: string } | null>(null)
