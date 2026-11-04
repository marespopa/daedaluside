/// <reference lib="webworker" />
import { GrepIndex, type GrepHit, type GrepRequest } from './grep'

/** Messages the main thread sends. File bytes are transferred, not copied. */
export type ToWorker =
  | { t: 'set'; files: { path: string; bytes: ArrayBuffer }[] }
  | { t: 'remove'; paths: string[] }
  | { t: 'clear' }
  | ({ t: 'search' } & GrepRequest)
  | { t: 'cancel' }

export type FromWorker =
  | { t: 'batch'; id: number; hits: GrepHit[] }
  | { t: 'done'; id: number; truncated: boolean }

const index = new GrepIndex()
const decoder = new TextDecoder()
/** The id of the search that should keep running; a newer one (or cancel) supersedes it. */
let current = 0

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  switch (m.t) {
    case 'set':
      for (const f of m.files) index.set(f.path, decoder.decode(f.bytes))
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
