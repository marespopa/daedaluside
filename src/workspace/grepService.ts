import {
  GrepIndex,
  HIT_LIMIT,
  looksBinary,
  MAX_FILE_BYTES,
  MAX_INDEX_BYTES,
  shouldIndex,
  type GrepHit,
  type GrepRequest,
} from './grep'
import type { FromWorker, IndexResult, ToWorker } from './grep.worker'
import { readForIndex } from './grepRead'
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
  /**
   * Reads and indexes these files itself, from the folder handle it was created with.
   * Absent when the workspace has no folder handle; the caller then reads and `set`s.
   */
  indexFiles?(paths: string[]): Promise<IndexResult[]>
  dispose(): void
}

export function createBackend(root?: FileSystemDirectoryHandle): GrepBackend {
  if (typeof Worker === 'undefined') return new LocalBackend(root)
  try {
    return new WorkerBackend(
      new Worker(new URL('./grep.worker.ts', import.meta.url), { type: 'module' }),
      root,
    )
  } catch {
    return new LocalBackend(root)
  }
}

class WorkerBackend implements GrepBackend {
  private listeners = new Map<
    number,
    { batch: (h: GrepHit[]) => void; done: (t: boolean) => void }
  >()
  private reads = new Map<number, (r: IndexResult[]) => void>()
  private readSeq = 0
  private readonly worker: Worker
  indexFiles?: (paths: string[]) => Promise<IndexResult[]>
  constructor(worker: Worker, root?: FileSystemDirectoryHandle) {
    this.worker = worker
    if (root) {
      this.post({ t: 'attach', root })
      this.indexFiles = (paths) =>
        new Promise((resolve) => {
          const id = ++this.readSeq
          this.reads.set(id, resolve)
          this.post({ t: 'index', id, paths })
        })
    }
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      if (m.t === 'indexed') {
        const done = this.reads.get(m.id)
        this.reads.delete(m.id)
        done?.(m.results)
        return
      }
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
    this.post(
      { t: 'set', files: out },
      out.map((f) => f.bytes),
    )
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
    for (const done of this.reads.values()) done([])
    this.reads.clear()
    this.worker.terminate()
  }
}

class LocalBackend implements GrepBackend {
  private index = new GrepIndex()
  private current = 0
  private decoder = new TextDecoder()
  indexFiles?: (paths: string[]) => Promise<IndexResult[]>
  constructor(root?: FileSystemDirectoryHandle) {
    if (root) {
      this.indexFiles = async (paths) => {
        const out: IndexResult[] = []
        for (const p of paths) {
          const r = await readForIndex(root, p, this.decoder)
          if (r.text !== null) this.index.set(r.path, r.text)
          else this.index.delete(r.path)
          out.push({ path: r.path, size: r.size, indexed: r.text !== null })
        }
        return out
      }
    }
  }
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
/** Files per request when the worker reads them itself. */
const BATCH = 8

/**
 * Keeps a `GrepBackend` in step with a workspace: indexes files in the background, then
 * only re-reads what changed (size) or what the controller reports as written.
 */
export class GrepService {
  // path -> size and mtime when indexed; a changed mtime re-reads even at the same size
  private known = new Map<string, { size: number; mtime: number | undefined }>()
  private queue: string[] = []
  private queued = new Set<string>()
  /** What the tree said about each queued file, recorded as `known` once it is indexed. */
  private sizes = new Map<string, { size: number; mtime: number | undefined }>()
  private pumping = false
  private disposed = false
  private bytes = 0
  private partial = false
  private seq = 0
  private statusTimer: ReturnType<typeof setTimeout> | undefined

  readonly fs: WorkspaceFS
  private readonly onStatus: (s: GrepStatus) => void
  private readonly backend: GrepBackend

  /**
   * With a folder `root` (and no explicit backend) the worker reads the files itself;
   * otherwise they are read here through `fs`.
   */
  constructor(
    fs: WorkspaceFS,
    onStatus: (s: GrepStatus) => void,
    backend?: GrepBackend,
    root?: FileSystemDirectoryHandle,
  ) {
    this.fs = fs
    this.onStatus = onStatus
    this.backend = backend ?? createBackend(root)
  }

  /** Brings the index in line with the tree: queues new or resized files, drops removed ones. */
  sync(entries: readonly Entry[]) {
    if (this.disposed) return
    const seen = new Set<string>()
    for (const e of entries) {
      if (e.kind !== 'file' || !shouldIndex(e.path, e.size)) continue
      seen.add(e.path)
      const k = this.known.get(e.path)
      if (!k || k.size !== (e.size ?? -1) || k.mtime !== e.mtime) {
        this.sizes.set(e.path, { size: e.size ?? -1, mtime: e.mtime })
        this.enqueue(e.path)
      }
    }
    const gone: string[] = []
    for (const [p, size] of this.known) {
      if (seen.has(p)) continue
      gone.push(p)
      this.bytes -= Math.max(size.size, 0)
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
    this.sizes.delete(path)
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
      if (this.queue.length === 0) this.wakeIdle()
    }
  }

  private idleWaiters: (() => void)[] = []

  private wakeIdle() {
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const w of waiters) w()
  }

  /** Resolves once every queued file is indexed (at once if nothing is pending). */
  idle(): Promise<void> {
    if (this.disposed || (!this.pumping && this.queue.length === 0))
      return Promise.resolve()
    return new Promise((r) => this.idleWaiters.push(r))
  }

  private async drain() {
    let n = 0
    const index = this.backend.indexFiles?.bind(this.backend)
    while (!this.disposed) {
      const batch: string[] = []
      while (batch.length < (index ? BATCH : 1)) {
        const path = this.queue.shift()
        if (path === undefined) break
        this.queued.delete(path)
        if (this.bytes >= MAX_INDEX_BYTES) {
          this.partial = true
          continue
        }
        batch.push(path)
      }
      if (batch.length === 0) return
      if (index) await this.indexInWorker(index, batch)
      else if (!(await this.readHere(batch[0]!))) return
      this.publish()
      // Let input and rendering through between reads on very large trees.
      n += batch.length
      if (n >= 16) {
        n = 0
        await new Promise<void>((r) => setTimeout(r, 0))
      }
    }
  }

  /** The backend reads the files from the folder handle; only sizes come back here. */
  private async indexInWorker(
    index: (paths: string[]) => Promise<IndexResult[]>,
    paths: string[],
  ) {
    const results = await index(paths)
    if (this.disposed) return
    const seen = new Set<string>()
    for (const r of results) {
      seen.add(r.path)
      if (r.size < 0) {
        // Unreadable or vanished mid-scan: leave it out, the next sync retries.
        this.known.delete(r.path)
        continue
      }
      this.record(r.path, r.size, r.indexed)
    }
    // A backend that was disposed mid-read answers with nothing; forget those files.
    for (const p of paths) if (!seen.has(p)) this.known.delete(p)
  }

  /** Reads through `fs` on this thread (single-file or non-folder workspaces). */
  private async readHere(path: string): Promise<boolean> {
    try {
      const bytes = await this.fs.readBytes(path)
      if (this.disposed) return false
      const text =
        bytes.length > 0 && !looksBinary(bytes) && bytes.length <= MAX_FILE_BYTES
      if (text) this.backend.set([{ path, bytes }])
      else this.backend.remove([path])
      this.record(path, bytes.length, text)
    } catch {
      // Unreadable or vanished mid-scan: leave it out, the next sync retries.
      this.known.delete(path)
    }
    return true
  }

  private record(path: string, size: number, indexed: boolean) {
    // Remember it as handled even when skipped, so an unchanged binary is not re-read on every sync.
    this.known.set(path, { size, mtime: this.sizes.get(path)?.mtime })
    this.sizes.delete(path)
    if (indexed) this.bytes += size
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
    this.wakeIdle()
    clearTimeout(this.statusTimer)
    this.queue = []
    this.queued.clear()
    this.backend.dispose()
  }
}
