import {
  idbAll,
  idbDelete,
  idbGet,
  idbPut,
  fileLinkKey,
  linkKey,
  SETTINGS,
  WORKSPACES,
} from './db'
import type { LinkedFile, LinkedFolder } from './types'

/** Stored in the `workspaces` IndexedDB store. The folder handle lives in settings. */
export interface WorkspaceMeta {
  id: string
  name: string
  created: number
  updated: number
  /** Last session: open buffers in tab order. */
  openFiles: string[]
  activeFile: string | null
  /** Last session: pinned subset of `openFiles`. */
  pinnedFiles?: string[]
  /** Identity of the folder source (see `sourceKey`). */
  source?: string | undefined
  /** `file` for a single-file workspace; absent means a folder workspace. */
  kind?: 'file' | undefined
  /** Set once the placeholder scratch.ts check has run for legacy blank workspaces. */
  scratchChecked?: boolean
}

const MAX_NAME = 100

const CHANNEL_NAME = 'daedalus-workspaces'

/**
 * A change made in another tab. `ws` is the workspace whose files changed, or null when
 * the workspace list changed.
 */
export interface RemoteChange {
  ws: string | null
}

type Listener = (change: RemoteChange) => void
const listeners = new Set<Listener>()
let channel: BroadcastChannel | null = null

/** One channel per page, shared by every manager. Null where BroadcastChannel is missing. */
function bus(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel !== 'function') return null
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (e: MessageEvent<RemoteChange>) => {
    for (const fn of listeners) fn(e.data)
  }
  // Do not keep a Node test process alive; browsers ignore this.
  ;(channel as unknown as { unref?: () => void }).unref?.()
  return channel
}

function announce(change: RemoteChange) {
  bus()?.postMessage(change)
}

export function cleanWorkspaceName(name: string): string {
  const n = name.trim()
  if (!n) throw new Error('Workspace name cannot be empty')
  if (n.length > MAX_NAME)
    throw new Error(`Workspace name is limited to ${MAX_NAME} characters`)
  return n
}

/**
 * Identity of a folder: a hash of its name and file layout. The same folder opened again
 * gets the same key, so it reuses the existing workspace instead of adding a duplicate.
 */
export async function sourceKey(name: string, filePaths: string[]): Promise<string> {
  const text = [name, ...[...filePaths].sort()].join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class WorkspaceManager {
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  /** Calls `fn` when another tab changes the workspace list. */
  onRemoteChange(fn: Listener): () => void {
    bus()
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  async list(): Promise<WorkspaceMeta[]> {
    const all = await idbAll<WorkspaceMeta>(this.db, 'workspaces')
    return all.sort((a, b) => a.created - b.created || a.name.localeCompare(b.name))
  }

  /**
   * Enforces the folder-only invariant: a workspace without a linked folder (a
   * record left by the old OPFS model, or one created without a link) can never
   * be read, so it is deleted. Returns the workspaces that remain, so callers
   * can treat the pruned store as the real list.
   */
  async pruneUnlinked(): Promise<WorkspaceMeta[]> {
    const kept: WorkspaceMeta[] = []
    const stale: string[] = []
    for (const w of await this.list()) {
      // Either link counts: a single-file workspace is a real workspace too.
      if ((await this.getLink(w.id)) || (await this.getFileLink(w.id))) kept.push(w)
      else stale.push(w.id)
    }
    if (stale.length > 0) {
      for (const id of stale) await this.deleteRecords(id)
      // One announcement for the whole prune, not one per deleted record.
      announce({ ws: null })
    }
    return kept
  }

  get(id: string): Promise<WorkspaceMeta | undefined> {
    return idbGet<WorkspaceMeta>(this.db, 'workspaces', id)
  }

  async findBySource(source: string): Promise<WorkspaceMeta | undefined> {
    return (await this.list()).find((w) => w.source === source)
  }

  async create(name: string, source?: string, kind?: 'file'): Promise<WorkspaceMeta> {
    const now = Date.now()
    const meta: WorkspaceMeta = {
      id: crypto.randomUUID(),
      name: cleanWorkspaceName(name),
      created: now,
      updated: now,
      openFiles: [],
      activeFile: null,
      ...(source ? { source } : {}),
      ...(kind ? { kind } : {}),
    }
    await idbPut(this.db, 'workspaces', meta.id, meta)
    announce({ ws: null })
    return meta
  }

  private async update(
    id: string,
    patch: Partial<WorkspaceMeta>,
  ): Promise<WorkspaceMeta> {
    const cur = await this.get(id)
    if (!cur) throw new Error('Workspace not found')
    const next = { ...cur, ...patch, id, updated: Date.now() }
    await idbPut(this.db, 'workspaces', id, next)
    return next
  }

  markScratchChecked(id: string): Promise<WorkspaceMeta> {
    return this.update(id, { scratchChecked: true })
  }

  async rename(id: string, name: string): Promise<WorkspaceMeta> {
    const meta = await this.update(id, { name: cleanWorkspaceName(name) })
    announce({ ws: null })
    return meta
  }

  saveSession(
    id: string,
    openFiles: string[],
    activeFile: string | null,
    pinnedFiles: string[] = [],
  ) {
    return this.update(id, { openFiles, activeFile, pinnedFiles })
  }

  /** The folder this workspace reads and writes through, if the user linked one. */
  getLink(id: string): Promise<LinkedFolder | undefined> {
    return idbGet<LinkedFolder>(this.db, 'settings', linkKey(id))
  }

  setLink(id: string, folder: LinkedFolder): Promise<void> {
    return idbPut(this.db, 'settings', linkKey(id), folder)
  }

  /** The file a single-file workspace reads and writes through. */
  getFileLink(id: string): Promise<LinkedFile | undefined> {
    return idbGet<LinkedFile>(this.db, 'settings', fileLinkKey(id))
  }

  setFileLink(id: string, file: LinkedFile): Promise<void> {
    return idbPut(this.db, 'settings', fileLinkKey(id), file)
  }

  /**
   * Deletes the workspace record and its linked-folder record from IndexedDB. Files on
   * disk are left untouched: the picked folder is the source of truth.
   */
  async remove(id: string): Promise<void> {
    await this.deleteRecords(id)
    announce({ ws: null })
  }

  /** The storage-side half of `remove`, without the cross-tab announcement. */
  private async deleteRecords(id: string): Promise<void> {
    await idbDelete(this.db, WORKSPACES, id)
    await idbDelete(this.db, SETTINGS, linkKey(id))
    await idbDelete(this.db, SETTINGS, fileLinkKey(id))
  }

  async getLastId(): Promise<string | null> {
    const s = await idbGet<{ lastWorkspaceId?: string }>(this.db, 'settings', 'app')
    return s?.lastWorkspaceId ?? null
  }

  async setLastId(id: string): Promise<void> {
    const s = (await idbGet<Record<string, unknown>>(this.db, 'settings', 'app')) ?? {}
    await idbPut(this.db, 'settings', 'app', { ...s, lastWorkspaceId: id })
  }
}
