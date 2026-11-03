import type { createStore } from 'jotai'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  openBuffersAtom,
  snapshotAtom,
  treeAtom,
  workspacesAtom,
  workspaceStatusAtom,
  type SessionSnapshot,
} from '../state/workspaceAtoms'

type Store = ReturnType<typeof createStore>

export const SNAPSHOT_KEY = 'daedalus.session'
/** Caps the snapshot size; the skeleton only needs the top of a large tree. */
export const MAX_SNAPSHOT_ENTRIES = 500

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const isEntry = (v: unknown): v is SessionSnapshot['tree'][number] =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { path?: unknown }).path === 'string' &&
  ((v as { kind?: unknown }).kind === 'file' || (v as { kind?: unknown }).kind === 'dir')

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Reads the saved session. Anything malformed or unavailable counts as no snapshot. */
export function readSnapshot(
  storage: Storage | undefined = safeStorage(),
): SessionSnapshot | null {
  try {
    const raw = storage?.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const s = v as Record<string, unknown>
    if (
      typeof s.workspaceId !== 'string' ||
      typeof s.name !== 'string' ||
      !Array.isArray(s.tree) ||
      !s.tree.every(isEntry) ||
      !isStringArray(s.openFiles) ||
      (s.activeFile !== null && typeof s.activeFile !== 'string')
    )
      return null
    return {
      workspaceId: s.workspaceId,
      name: s.name,
      tree: s.tree,
      openFiles: s.openFiles,
      activeFile: s.activeFile,
    }
  } catch {
    return null
  }
}

/** Best effort: private modes and full quotas must not break the app. */
export function writeSnapshot(
  snap: SessionSnapshot,
  storage: Storage | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
  } catch {
    /* ignore */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Builds the snapshot from live state. Null until the workspace is fully ready. */
export function buildSnapshot(store: Store): SessionSnapshot | null {
  if (store.get(workspaceStatusAtom).state !== 'ready') return null
  const id = store.get(currentWorkspaceIdAtom)
  const name = store.get(workspacesAtom).find((w) => w.id === id)?.name
  if (!id || name === undefined) return null
  return {
    workspaceId: id,
    name,
    tree: store
      .get(treeAtom)
      .slice(0, MAX_SNAPSHOT_ENTRIES)
      .map((e) => ({ path: e.path, kind: e.kind })),
    openFiles: store.get(openBuffersAtom).map((b) => b.path),
    activeFile: store.get(activePathAtom),
  }
}

/**
 * Loads the saved session into `snapshotAtom` and keeps localStorage in step with
 * the live state. Call once per store.
 */
export function startSnapshotSync(store: Store): () => void {
  store.set(snapshotAtom, readSnapshot())
  const persist = () => {
    const snap = buildSnapshot(store)
    if (snap) writeSnapshot(snap)
  }
  const unsubs = [
    workspaceStatusAtom,
    currentWorkspaceIdAtom,
    workspacesAtom,
    treeAtom,
    openBuffersAtom,
    activePathAtom,
  ].map((a) => store.sub(a, persist))
  return () => unsubs.forEach((u) => u())
}
