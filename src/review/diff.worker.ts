/// <reference lib="webworker" />
import { diffTexts, type DiffResult } from './diff'

/** Messages the main thread sends. */
export type ToWorker = { t: 'diff'; id: number; base: string; current: string }

export type FromWorker =
  ({ t: 'result'; id: number } & DiffResult) | { t: 'error'; id: number }

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.t !== 'diff') return
  try {
    post({ t: 'result', id: m.id, ...diffTexts(m.base, m.current) })
  } catch {
    post({ t: 'error', id: m.id })
  }
}
