import { IdbBackend } from './fallback-idb'
import { openDB } from './db'
import { RpcBackend } from './rpc'
import type { FSBackend } from './types'

export * from './types'
export { RpcBackend } from './rpc'

const PROBE_TIMEOUT_MS = 5000

function opfsAvailable(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

/**
 * Capability detection at startup: prefer OPFS in a worker, verified by a real
 * sync-handle write; otherwise fall back to IndexedDB.
 */
export async function createBackend(db?: IDBDatabase): Promise<FSBackend> {
  if (opfsAvailable()) {
    let worker: Worker | undefined
    try {
      worker = new Worker(new URL('./fs.worker.ts', import.meta.url), { type: 'module' })
      const backend = new RpcBackend(worker)
      await Promise.race([
        backend.probe(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OPFS probe timed out')), PROBE_TIMEOUT_MS),
        ),
      ])
      return backend
    } catch {
      worker?.terminate()
    }
  }
  return new IdbBackend(db ?? (await openDB()))
}
