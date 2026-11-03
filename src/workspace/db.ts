/** Workspace file nodes: one record per file or folder, keyed `workspaceId:nodeId`. */
export const FS_META = 'fs-meta'
/** File bytes, keyed like FS_META. Folders have no record here. */
export const FS_BLOB = 'fs-blob'
/** Index on FS_META: `[ws, parent, name]`, unique. Finds a child and lists a folder. */
export const BY_PARENT = 'byParent'
export const WORKSPACES = 'workspaces'
export const SETTINGS = 'settings'

/** Store names from ARCHITECTURE.md §6. All are created up front so later milestones need no upgrade. */
export const STORES = [
  SETTINGS,
  'vault',
  WORKSPACES,
  'runs',
  'snapshots',
  FS_META,
  FS_BLOB,
] as const
export type StoreName = (typeof STORES)[number]

/** Where a workspace's linked folder handle is kept in SETTINGS. */
export const linkKey = (workspaceId: string) => `link:${workspaceId}`

export const DB_NAME = 'daedalus'
/**
 * Version 2 added path-keyed file stores. Version 3 keys files by id with a parent index.
 * The version 2 records cannot be read in that layout, so the upgrade clears them.
 */
const DB_VERSION = 3

export function openDB(
  name = DB_NAME,
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
      }
      const tx = req.transaction!
      const oldVersion = event.oldVersion
      if (oldVersion > 0 && oldVersion < 3) {
        // Old file records and their workspace list go; the app starts with a fresh workspace.
        tx.objectStore(FS_META).clear()
        tx.objectStore(FS_BLOB).clear()
        tx.objectStore(WORKSPACES).clear()
      }
      const meta = tx.objectStore(FS_META)
      if (!meta.indexNames.contains(BY_PARENT))
        meta.createIndex(BY_PARENT, ['ws', 'parent', 'name'], { unique: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

export function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Resolves when the transaction commits, so callers know data is durable. */
export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

export async function idbGet<T>(db: IDBDatabase, store: StoreName, key: IDBValidKey) {
  return (await wrap(db.transaction(store).objectStore(store).get(key))) as T | undefined
}

export async function idbPut(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
  value: unknown,
) {
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value, key)
  await done(tx)
}

export async function idbDelete(db: IDBDatabase, store: StoreName, key: IDBValidKey) {
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  await done(tx)
}

export async function idbAll<T>(db: IDBDatabase, store: StoreName) {
  return (await wrap(db.transaction(store).objectStore(store).getAll())) as T[]
}
