/// <reference lib="webworker" />
import { walkFolder } from './folderWalk'
import type { Entry } from './types'

/** The main thread hands over a directory handle (structured-cloneable) and gets chunks back. */
export type WalkToWorker = { t: 'walk'; id: number; root: FileSystemDirectoryHandle }

export type WalkFromWorker =
  | { t: 'chunk'; id: number; entries: Entry[] }
  | { t: 'progress'; id: number; count: number }
  | { t: 'done'; id: number }
  | { t: 'error'; id: number; name: string; message: string }

const post = (m: WalkFromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = async (e: MessageEvent<WalkToWorker>) => {
  const { id, root } = e.data
  try {
    await walkFolder(root, {
      onChunk: (entries) => post({ t: 'chunk', id, entries }),
      onProgress: (count) => post({ t: 'progress', id, count }),
    })
    post({ t: 'done', id })
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error'
    const message = err instanceof Error ? err.message : String(err)
    post({ t: 'error', id, name, message })
  }
}
