/// <reference lib="webworker" />
import { GrepIndex, type GrepHit, type GrepRequest } from './grep'
import { readForIndex } from './grepRead'

/** Messages the main thread sends. File bytes are transferred, not copied. */
export type ToWorker =
  | { t: 'set'; files: { path: string; bytes: ArrayBuffer }[] }
  | { t: 'attach'; root: FileSystemDirectoryHandle }
  | { t: 'index'; id: number; paths: string[] }
  | { t: 'remove'; paths: string[] }
  | { t: 'clear' }
  | ({ t: 'search' } & GrepRequest)
  | { t: 'cancel' }

/** Outcome of reading one file for the index; `size` is -1 when it could not be read. */
export interface IndexResult {
  path: string
  size: number
  indexed: boolean
}

export type FromWorker =
  | { t: 'indexed'; id: number; results: IndexResult[] }
  | { t: 'batch'; id: number; hits: GrepHit[] }
  | { t: 'done'; id: number; truncated: boolean }

const index = new GrepIndex()
const decoder = new TextDecoder()
/** The id of the search that should keep running; a newer one (or cancel) supersedes it. */
let current = 0

let root: FileSystemDirectoryHandle | null = null
/** Files read at once; the worker has no UI to keep responsive, only the disk to keep busy. */
const READ_CONCURRENCY = 4

async function indexPaths(id: number, paths: string[]) {
  const results: IndexResult[] = []
  if (root) {
    const dir = root
    let next = 0
    const lane = async () => {
      while (next < paths.length) {
        const r = await readForIndex(dir, paths[next++]!, decoder)
        if (r.text !== null) index.set(r.path, r.text)
        else index.delete(r.path)
        results.push({ path: r.path, size: r.size, indexed: r.text !== null })
      }
    }
    await Promise.all(Array.from({ length: READ_CONCURRENCY }, lane))
  }
  post({ t: 'indexed', id, results })
}

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  switch (m.t) {
    case 'set':
      for (const f of m.files) index.set(f.path, decoder.decode(f.bytes))
      break
    case 'attach':
      root = m.root
      break
    case 'index':
      void indexPaths(m.id, m.paths)
      break
    case 'remove':
      for (const p of m.paths) index.delete(p)
      break
    case 'clear':
      index.clear()
      break
    case 'cancel':
      current = 0
      break
    case 'search': {
      current = m.id
      const id = m.id
      void index
        .search(
          m,
          (hits) => post({ t: 'batch', id, hits }),
          () => current !== id,
        )
        .then((r) => {
          if (!r.cancelled) post({ t: 'done', id, truncated: r.truncated })
        })
      break
    }
  }
}
