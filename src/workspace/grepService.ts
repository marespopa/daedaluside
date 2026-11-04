import {
  GrepIndex,
  HIT_LIMIT,
  looksBinary,
  MAX_INDEX_BYTES,
  shouldIndex,
  type GrepHit,
  type GrepRequest,
} from './grep'
import type { FromWorker, ToWorker } from './grep.worker'
import type { Entry, WorkspaceFS } from './types'

/** Where the index lives: a Web Worker in the browser, in-process elsewhere. */
export interface GrepBackend {
  set(files: { path: string; bytes: Uint8Array }[]): void
  remove(paths: string[]): void
  clear(): void
  search(
    req: GrepRequest,
    onBatch: (hits: GrepHit[]) => void,
    onDone: (truncated: boolean) => void,
  ): void
  cancel(): void
  dispose(): void
}

export function createBackend(): GrepBackend {
  if (typeof Worker === 'undefined') return new LocalBackend()
  try {
    return new WorkerBackend(
      new Worker(new URL('./grep.worker.ts', import.meta.url), { type: 'module' }),
    )
  } catch {
    return new LocalBackend()
  }
}

class WorkerBackend implements GrepBackend {
  private listeners = new Map<
    number,
    { batch: (h: GrepHit[]) => void; done: (t: boolean) => void }
  >()
  private readonly worker: Worker
  constructor(worker: Worker) {
    this.worker = worker
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      const l = this.listeners.get(m.id)
      if (!l) return
      if (m.t === 'batch') l.batch(m.hits)
      else {
        this.listeners.delete(m.id)
        l.done(m.truncated)
      }
    }
  }
  private post(m: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer)
  }
  set(files: { path: string; bytes: Uint8Array }[]) {
    // `readBytes` returns a view that owns its buffer, so transferring it is free.
    const out = files.map((f) => ({ path: f.path, bytes: f.bytes.buffer as ArrayBuffer }))
    this.post({ t: 'set', files: out }, out.map((f) => f.bytes))
  }
  remove(paths: string[]) {
    this.post({ t: 'remove', paths })
  }
  clear() {
    this.post({ t: 'clear' })
  }
  search(
    req: GrepRequest,
    onBatch: (hits: GrepHit[]) => void,
    onDone: (truncated: boolean) => void,
  ) {
    this.listeners.set(req.id, { batch: onBatch, done: onDone })
    this.post({ t: 'search', ...req })
  }
  cancel() {
    this.listeners.clear()
    this.post({ t: 'cancel' })
  }
  dispose() {
    this.listeners.clear()
    this.worker.terminate()
  }
}

class LocalBackend implements GrepBackend {
  private index = new GrepIndex()
  private current = 0
  private decoder = new TextDecoder()
  set(files: { path: string; bytes: Uint8Array }[]) {
    for (const f of files) this.index.set(f.path, this.decoder.decode(f.bytes))
  }
  remove(paths: string[]) {
    for (const p of paths) this.index.delete(p)
  }
  clear() {
    this.index.clear()
  }
  search(
    req: GrepRequest,
    onBatch: (hits: GrepHit[]) => void,
    onDone: (truncated: boolean) => void,
  ) {
    this.current = req.id
    void this.index
      .search(req, onBatch, () => this.current !== req.id)
      .then((r) => {
        if (!r.cancelled) onDone(r.truncated)
      })
  }
  cancel() {
    this.current = 0
  }
  dispose() {
    this.current = 0
    this.index.clear()
  }
}

export interface GrepStatus {
  /** Files in the index so far. */
  indexed: number
  /** Files that will be indexed once the queue drains. */
  total: number
  /** Some files were left out (memory cap). */
  partial: boolean
}

// FolderFS runs every call through one serial queue, so a deep read-ahead would make a
// file the user opens wait behind the whole index. Two in flight keeps it busy.
const READ_CONCURRENCY = 2

/**
 * Keeps a `GrepBackend` in step with a workspace: indexes files in the background, then
 * only re-reads what changed (size) or what the controller reports as written.
 */
export class GrepService {
  private known = new Map<string, number>() // path -> size when indexed
  private queue: string[] = []
  private queued = new Set<string>()
  private pumping = false
  private disposed = false
  private bytes = 0
  private partial = false
  private seq = 0
  private statusTimer: ReturnType<typeof setTimeout> | undefined

  readonly fs: WorkspaceFS
  private readonly onStatus: (s: GrepStatus) => void
  private readonly backend: GrepBackend

  constructor(
    fs: WorkspaceFS,
    onStatus: (s: GrepStatus) => void,
    backend: GrepBackend = createBackend(),
  ) {
    this.fs = fs
    this.onStatus = onStatus
    this.backend = backend
  }

  /** Brings the index in line with the tree: queues new or resized files, drops removed ones. */
  sync(entries: readonly Entry[]) {
    if (this.disposed) return
    const seen = new Set<string>()
    for (const e of entries) {
      if (e.kind !== 'file' || !shouldIndex(e.path, e.size)) continue
      seen.add(e.path)
      if (this.known.get(e.path) !== (e.size ?? -1)) this.enqueue(e.path)
    }
    const gone: string[] = []
    for (const [p, size] of this.known) {
      if (seen.has(p)) continue
      gone.push(p)
      this.bytes -= Math.max(size, 0)
      this.known.delete(p)
    }
    // Queued paths that vanished need not be read.
    this.queue = this.queue.filter((p) => seen.has(p))
    for (const p of [...this.queued]) if (!seen.has(p)) this.queued.delete(p)
    if (gone.length > 0) this.backend.remove(gone)
    this.publish()
    void this.pump()
  }

  /** A file was written by the editor: re-read it. */
  touch(path: string) {
    if (this.disposed || !shouldIndex(path, undefined)) return
    this.known.delete(path)
    this.enqueue(path)
    void this.pump()
  }

  private enqueue(path: string) {
    if (this.queued.has(path)) return
    this.queued.add(path)
    this.queue.push(path)
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      const workers = Array.from({ length: READ_CONCURRENCY }, () => this.drain())
      await Promise.all(workers)
    } finally {
      this.pumping = false
      this.publish(true)
    }
  }

  private async drain() {
    let n = 0
    while (!this.disposed) {
      const path = this.queue.shift()
      if (path === undefined) return
      this.queued.delete(path)
      if (this.bytes >= MAX_INDEX_BYTES) {
        this.partial = true
        continue
      }
      try {
        const bytes = await this.fs.readBytes(path)
        if (this.disposed) return
        if (bytes.length > 0 && !looksBinary(bytes) && bytes.length <= 1024 * 1024) {
          this.backend.set([{ path, bytes }])
          this.known.set(path, bytes.length)
          this.bytes += bytes.length
        } else {
          // Remember it as handled so an unchanged binary is not re-read on every sync.
          this.known.set(path, bytes.length)
          this.backend.remove([path])
        }
      } catch {
        // Unreadable or vanished mid-scan: leave it out, the next sync retries.
        this.known.delete(path)
      }
      this.publish()
      // Let input and rendering through between reads on very large trees.
      if (++n % 16 === 0) await new Promise<void>((r) => setTimeout(r, 0))
    }
  }

  private publish(now = false) {
    if (now) {
      clearTimeout(this.statusTimer)
      this.statusTimer = undefined
      this.emitStatus()
    } else if (this.statusTimer === undefined) {
      this.statusTimer = setTimeout(() => {
        this.statusTimer = undefined
        this.emitStatus()
      }, 100)
    }
  }

  private emitStatus() {
    if (this.disposed) return
    this.onStatus({
      indexed: this.known.size,
      total: this.known.size + this.queue.length,
      partial: this.partial,
    })
  }

  /** Starts a search; the returned function cancels it. */
  search(
    query: string,
    priority: readonly string[],
    onBatch: (hits: GrepHit[]) => void,
    onDone: (truncated: boolean) => void,
  ): () => void {
    const id = ++this.seq
    let live = true
    this.backend.search(
      { id, query, limit: HIT_LIMIT, priority },
      (h) => live && onBatch(h),
      (t) => live && onDone(t),
    )
    return () => {
      if (!live) return
      live = false
      this.backend.cancel()
    }
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.statusTimer)
    this.queue = []
    this.queued.clear()
    this.backend.dispose()
  }
}
