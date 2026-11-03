import { openDB } from './db'
import { OpfsBackend } from './opfs'
import type { FSBackend } from './types'

export * from './types'

/**
 * Workspace file storage uses the Origin Private File System. File bytes live in
 * OPFS under `workspaces/<workspaceId>`; workspace metadata remains in IndexedDB.
 */
export async function createBackend(db?: IDBDatabase): Promise<FSBackend> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error(
      'Your browser does not support the Origin Private File System (OPFS), which Daedalus needs for workspace storage.',
    )
  }
  const root = await navigator.storage.getDirectory()
  return new OpfsBackend(root, db ?? (await openDB()))
}
