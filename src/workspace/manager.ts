import { idbAll, idbDelete, idbGet, idbPut } from './db'
import type { FSBackend, WorkspaceFS } from './types'

/** Stored in the `workspaces` IndexedDB store. File contents live in the FS backend. */
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
  /** Identity of the imported source (see `sourceKey`). Absent for blank workspaces. */
  source?: string | undefined
}

const MAX_NAME = 100

export function cleanWorkspaceName(name: string): string {
  const n = name.trim()
  if (!n) throw new Error('Workspace name cannot be empty')
  if (n.length > MAX_NAME)
    throw new Error(`Workspace name is limited to ${MAX_NAME} characters`)
  return n
}

/**
 * Identity of an imported folder or zip: a hash of its name and file layout. The
 * same folder opened again gets the same key, so it reuses the existing workspace
 * instead of adding a duplicate entry.
 */
export async function sourceKey(name: string, filePaths: string[]): Promise<string> {
  const text = [name, ...[...filePaths].sort()].join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class WorkspaceManager {
  readonly backend: FSBackend
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase, backend: FSBackend) {
    this.db = db
    this.backend = backend
  }

  fs(id: string): WorkspaceFS {
    return this.backend.open(id)
  }

  async list(): Promise<WorkspaceMeta[]> {
    const all = await idbAll<WorkspaceMeta>(this.db, 'workspaces')
    return all.sort((a, b) => a.created - b.created || a.name.localeCompare(b.name))
  }

  get(id: string): Promise<WorkspaceMeta | undefined> {
    return idbGet<WorkspaceMeta>(this.db, 'workspaces', id)
  }

  async findBySource(source: string): Promise<WorkspaceMeta | undefined> {
    return (await this.list()).find((w) => w.source === source)
  }

  async create(name: string, source?: string | undefined): Promise<WorkspaceMeta> {
    const now = Date.now()
    const meta: WorkspaceMeta = {
      id: crypto.randomUUID(),
      name: cleanWorkspaceName(name),
      created: now,
      updated: now,
      openFiles: [],
      activeFile: null,
      ...(source ? { source } : {}),
    }
    await this.fs(meta.id).mkdir('')
    await idbPut(this.db, 'workspaces', meta.id, meta)
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

  rename(id: string, name: string): Promise<WorkspaceMeta> {
    return this.update(id, { name: cleanWorkspaceName(name) })
  }

  saveSession(
    id: string,
    openFiles: string[],
    activeFile: string | null,
    pinnedFiles: string[] = [],
  ) {
    return this.update(id, { openFiles, activeFile, pinnedFiles })
  }

  /** Deletes files first, so a crash leaves a visible (empty) workspace, not leaked data. */
  async remove(id: string): Promise<void> {
    await this.backend.destroy(id)
    await idbDelete(this.db, 'workspaces', id)
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
