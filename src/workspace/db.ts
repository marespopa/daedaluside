export const WORKSPACES = 'workspaces'
export const SETTINGS = 'settings'

/** Store names from ARCHITECTURE.md §6. All are created up front so later milestones need no upgrade. */
export const STORES = [SETTINGS, 'vault', WORKSPACES, 'runs', 'snapshots'] as const
export type StoreName = (typeof STORES)[number]

/** Where a workspace's linked folder handle is kept in SETTINGS. */
export const linkKey = (workspaceId: string) => `link:${workspaceId}`

export const DB_NAME = 'daedalus'
/**
 * Version 2 added path-keyed file stores. Version 3 keyed files by id with a parent index.
 * Version 4 removes the IndexedDB file stores now that workspace files live in OPFS.
 */
const DB_VERSION = 4

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
      if (oldVersion > 0 && oldVersion < 4) {
        // Old file stores are gone; workspace files now live in OPFS.
        if (db.objectStoreNames.contains('fs-meta')) db.deleteObjectStore('fs-meta')
        if (db.objectStoreNames.contains('fs-blob')) db.deleteObjectStore('fs-blob')
      }
      if (oldVersion > 0 && oldVersion < 3) {
        // Old file records and their workspace list go; the app starts with a fresh workspace.
        tx.objectStore(WORKSPACES).clear()
      }
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
