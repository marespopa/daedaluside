import { IDBFactory } from 'fake-indexeddb'
import { createMemoryOpfs, MemRoot } from './memoryOpfs'

let currentRoot: MemRoot | null = null

/**
 * Installs a fresh in-memory OPFS root and a fresh fake IndexedDB instance for each test.
 * Returns the memory root so tests can make direct assertions on the same storage the app uses.
 */
export function installMemoryOpfs(): MemRoot {
  currentRoot = createMemoryOpfs()
  globalThis.indexedDB = new IDBFactory()
  const root = currentRoot
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: {
      getDirectory: () => Promise.resolve(root.rootHandle()),
      estimate: () =>
        Promise.resolve({ usage: 1024 * 1024, quota: 1024 * 1024 * 1024 }),
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(true),
    },
    configurable: true,
    writable: true,
  })
  return currentRoot
}

/** The memory OPFS root installed by the most recent `installMemoryOpfs()` call. */
export function getMemoryOpfs(): MemRoot {
  if (!currentRoot) throw new Error('installMemoryOpfs() has not been called')
  return currentRoot
}
