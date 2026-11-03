import { IdbBackend } from './fallback-idb'
import { openDB } from './db'
import type { FSBackend } from './types'

export * from './types'

/**
 * Workspace storage is IndexedDB. Every tab reads and writes the same database, so
 * several tabs can share workspaces. (OPFS was dropped: its sync access handles are
 * exclusive per file across tabs, so two tabs could not open the same workspace.)
 */
export async function createBackend(db?: IDBDatabase): Promise<FSBackend> {
  return new IdbBackend(db ?? (await openDB()))
}
