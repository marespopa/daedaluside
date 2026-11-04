import { diffTexts, hunkStats, streamHunks, type DiffResult, type DiffStats, type Hunk } from './diff'
import type { FromWorker, ToWorker } from './diff.worker'

/** Where diffs are computed: a Web Worker in the browser, in-process elsewhere. */
export interface DiffBackend {
  compute(
    id: number,
    base: string,
    current: string,
    onDone: (r: DiffResult | null) => void,
  ): void
  /** Streams hunks as they are found; `onDone` gets the totals, or null on failure. */
  stream(
    id: number,
    base: string,
    current: string,
    onPartial: (hunks: Hunk[]) => void,
    onDone: (stats: DiffStats | null) => void,
  ): void
  /** Stops a stream; its callbacks no longer run. */
  cancel(id: number): void
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
  private streams = new Map<
    number,
    { partial: (h: Hunk[]) => void; done: (s: DiffStats | null) => void }
  >()
  private readonly worker: Worker
  constructor(worker: Worker) {
    this.worker = worker
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      if (m.t === 'partial' || m.t === 'done') {
        const s = this.streams.get(m.id)
        if (!s) return
        if (m.t === 'partial') return s.partial(m.hunks)
        this.streams.delete(m.id)
        return s.done(m.stats)
      }
      const st = this.streams.get(m.id)
      if (st && m.t === 'error') {
        this.streams.delete(m.id)
        return st.done(null)
      }
      const l = this.listeners.get(m.id)
      if (!l) return
      this.listeners.delete(m.id)
      l(m.t === 'result' ? { hunks: m.hunks, stats: m.stats } : null)
    }
  }
  stream(
    id: number,
    base: string,
    current: string,
    onPartial: (hunks: Hunk[]) => void,
    onDone: (stats: DiffStats | null) => void,
  ) {
    this.streams.set(id, { partial: onPartial, done: onDone })
    const m: ToWorker = { t: 'stream', id, base, current }
    this.worker.postMessage(m)
  }
  cancel(id: number) {
    if (!this.streams.delete(id)) return
    const m: ToWorker = { t: 'cancel', id }
    this.worker.postMessage(m)
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
    this.streams.clear()
    this.worker.terminate()
  }
}

class LocalBackend implements DiffBackend {
  private disposed = false
  private readonly stopped = new Set<number>()
  stream(
    id: number,
    base: string,
    current: string,
    onPartial: (hunks: Hunk[]) => void,
    onDone: (stats: DiffStats | null) => void,
  ) {
    const all: Hunk[] = []
    const off = () => this.disposed || this.stopped.has(id)
    streamHunks(
      base,
      current,
      (h) => {
        all.push(...h)
        if (!off()) onPartial(h)
      },
      off,
    )
      .then((finished) => {
        if (finished && !off()) onDone(hunkStats(all))
      })
      .catch(() => {
        if (!off()) onDone(null)
      })
  }
  cancel(id: number) {
    this.stopped.add(id)
  }
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

let shared: DiffBackend | null = null
let nextStreamId = 1
/**
 * Diffs two texts off the main thread, delivering hunks as they are found. Returns a
 * function that stops it. One worker serves every caller.
 */
export function streamDiff(
  base: string,
  current: string,
  onPartial: (hunks: Hunk[]) => void,
  onDone: (stats: DiffStats | null) => void,
): () => void {
  const backend = (shared ??= createBackend())
  const id = nextStreamId++
  let live = true
  backend.stream(
    id,
    base,
    current,
    (h) => live && onPartial(h),
    (s) => live && onDone(s),
  )
  return () => {
    live = false
    backend.cancel(id)
  }
}
