import { diffTexts, type DiffResult } from './diff'
import type { FromWorker, ToWorker } from './diff.worker'

/** Where diffs are computed: a Web Worker in the browser, in-process elsewhere. */
export interface DiffBackend {
  compute(
    id: number,
    base: string,
    current: string,
    onDone: (r: DiffResult | null) => void,
  ): void
  dispose(): void
}

export function createBackend(): DiffBackend {
  if (typeof Worker === 'undefined') return new LocalBackend()
  try {
    return new WorkerBackend(
      new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' }),
    )
  } catch {
    return new LocalBackend()
  }
}

class WorkerBackend implements DiffBackend {
  private listeners = new Map<number, (r: DiffResult | null) => void>()
  private readonly worker: Worker
  constructor(worker: Worker) {
    this.worker = worker
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      const l = this.listeners.get(m.id)
      if (!l) return
      this.listeners.delete(m.id)
      l(m.t === 'result' ? { hunks: m.hunks, stats: m.stats } : null)
    }
  }
  compute(
    id: number,
    base: string,
    current: string,
    onDone: (r: DiffResult | null) => void,
  ) {
    this.listeners.set(id, onDone)
    const m: ToWorker = { t: 'diff', id, base, current }
    this.worker.postMessage(m)
  }
  dispose() {
    this.listeners.clear()
    this.worker.terminate()
  }
}

class LocalBackend implements DiffBackend {
  private disposed = false
  compute(
    _id: number,
    base: string,
    current: string,
    onDone: (r: DiffResult | null) => void,
  ) {
    // Async like the worker, so callers never see a result before `schedule` returns.
    void Promise.resolve().then(() => {
      if (this.disposed) return
      try {
        onDone(diffTexts(base, current))
      } catch {
        onDone(null)
      }
    })
  }
  dispose() {
    this.disposed = true
  }
}

export const DEBOUNCE_MS = 150

/**
 * Debounced diffing. Each `schedule` supersedes the one before it, whether it is still
 * waiting out the debounce or already computing: only the newest result is delivered.
 */
export class DiffService {
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private readonly backend: DiffBackend
  private readonly delay: number

  constructor(backend: DiffBackend = createBackend(), delay = DEBOUNCE_MS) {
    this.backend = backend
    this.delay = delay
  }

  /** Diffs after the debounce; `onResult` runs only if nothing newer was scheduled. */
  schedule(
    base: string,
    current: string,
    onResult: (r: DiffResult) => void,
    immediate = false,
  ) {
    if (this.disposed) return
    const id = ++this.seq
    clearTimeout(this.timer)
    const run = () => {
      this.timer = undefined
      this.backend.compute(id, base, current, (r) => {
        if (r && id === this.seq && !this.disposed) onResult(r)
      })
    }
    if (immediate) run()
    else this.timer = setTimeout(run, this.delay)
  }

  /** Drops whatever is pending or in flight. */
  cancel() {
    this.seq++
    clearTimeout(this.timer)
    this.timer = undefined
  }

  dispose() {
    this.disposed = true
    this.cancel()
    this.backend.dispose()
  }
}
