/// <reference lib="webworker" />
import { diffTexts, hunkStats, streamHunks, type DiffResult, type Hunk } from './diff'

/** Messages the main thread sends. */
export type ToWorker =
  | { t: 'diff'; id: number; base: string; current: string }
  | { t: 'stream'; id: number; base: string; current: string }
  | { t: 'cancel'; id: number }

export type FromWorker =
  | ({ t: 'result'; id: number } & DiffResult)
  | { t: 'partial'; id: number; hunks: Hunk[] }
  | { t: 'done'; id: number; stats: DiffResult['stats'] }
  | { t: 'error'; id: number }

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m)
const cancelled = new Set<number>()

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.t === 'cancel') {
    cancelled.add(m.id)
    return
  }
  if (m.t === 'diff') {
    try {
      post({ t: 'result', id: m.id, ...diffTexts(m.base, m.current) })
    } catch {
      post({ t: 'error', id: m.id })
    }
    return
  }
  const all: Hunk[] = []
  streamHunks(
    m.base,
    m.current,
    (hunks) => {
      all.push(...hunks)
      post({ t: 'partial', id: m.id, hunks })
    },
    () => cancelled.has(m.id),
  )
    .then((finished) => {
      if (finished) post({ t: 'done', id: m.id, stats: hunkStats(all) })
    })
    .catch(() => post({ t: 'error', id: m.id }))
    .finally(() => cancelled.delete(m.id))
}
