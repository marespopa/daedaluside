import { walkFolder } from './folderWalk'
import type { WalkFromWorker, WalkToWorker } from './walk.worker'
import type { Entry } from './types'

let nextId = 1

/**
 * Walks a folder in a Web Worker so the main thread stays free for the editor, streaming
 * chunks back as directories are read. Without Worker support, or if the worker cannot
 * start or the handle cannot be cloned, it walks on the main thread instead.
 */
export function walkInWorker(
  root: FileSystemDirectoryHandle,
  handlers: { onProgress?: ((count: number) => void) | undefined },
): Promise<Entry[]> {
  if (typeof Worker === 'undefined') return walkFolder(root, handlers)
  return new Promise<Entry[]>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./walk.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch {
      walkFolder(root, handlers).then(resolve, reject)
      return
    }
    const id = nextId++
    const out: Entry[] = []
    let started = false
    const finish = () => worker.terminate()
    worker.onmessage = (e: MessageEvent<WalkFromWorker>) => {
      const m = e.data
      if (m.id !== id) return
      started = true
      if (m.t === 'chunk') {
        out.push(...m.entries)
      } else if (m.t === 'progress') {
        handlers.onProgress?.(m.count)
      } else if (m.t === 'done') {
        finish()
        resolve(out)
      } else {
        finish()
        reject(new DOMException(m.message, m.name))
      }
    }
    const broke = () => {
      finish()
      // The worker never produced anything: fall back instead of failing the open.
      if (!started) walkFolder(root, handlers).then(resolve, reject)
      else reject(new Error('Folder reader stopped unexpectedly'))
    }
    worker.onerror = broke
    worker.onmessageerror = broke
    try {
      worker.postMessage({ t: 'walk', id, root } satisfies WalkToWorker)
    } catch {
      finish()
      walkFolder(root, handlers).then(resolve, reject)
    }
  })
}
