/** Store names from ARCHITECTURE.md §6. All are created up front so later milestones need no upgrade. */
export const STORES = [
  'settings',
  'vault',
  'workspaces',
  'runs',
  'snapshots',
  'fs-fallback',
] as const
export type StoreName = (typeof STORES)[number]

export const DB_NAME = 'daedalus'

export function openDB(
  name = DB_NAME,
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
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
