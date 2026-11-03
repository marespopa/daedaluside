import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from './db'
import { IdbBackend } from './fallback-idb'
import { runFSContract } from './fsContract'

runFSContract('IndexedDB fallback', async () => {
  const db = await openDB('t', new IDBFactory())
  return new IdbBackend(db)
})
