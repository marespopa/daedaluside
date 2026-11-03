import type { ImportEntry } from './archive'
import { basename } from './path'
import type { Entry, WorkspaceFS } from './types'

/** Source reads in flight at once. Reads from a disk folder are the slow part. */
export const COPY_CONCURRENCY = 4

interface Job {
  entry: ImportEntry
  path: string
  promise: Promise<void>
  resolve: () => void
  reject: (e: unknown) => void
}

export interface CopyProgress {
  /** Entries written so far, folders included. */
  done: number
  failed: number
  total: number
}

/**
 * Copies an import into a workspace in the background, so the workspace can open
 * before everything is copied. Source reads run in parallel, since they are the slow
 * part; writes go through one chain, in order, because the workspace FS serializes
 * them anyway. A file can be promoted to the front, so the one the user opened is
 * copied next. Entries not yet copied are listed as pending.
 */
export class ImportQueue {
  readonly total: number
  /** Resolves when nothing is queued or in flight (after completion or cancel). */
  readonly idle: Promise<void>

  private queued: Job[] = []
  private jobs = new Map<string, Job>()
  private reading = 0
  private writes: Promise<unknown> = Promise.resolve()
  private settled = 0
  private failed = 0
  private cancelled = false
  private idleResolve!: () => void
  private readonly concurrency: number
  private readonly onProgress: ((p: CopyProgress) => void) | undefined
  private readonly fs: WorkspaceFS

  constructor(
    fs: WorkspaceFS,
    entries: ImportEntry[],
    opts: { concurrency?: number; onProgress?: (p: CopyProgress) => void } = {},
  ) {
    this.fs = fs
    this.total = entries.length
    this.concurrency = opts.concurrency ?? COPY_CONCURRENCY
    this.onProgress = opts.onProgress
    this.idle = new Promise<void>((resolve) => (this.idleResolve = resolve))
    for (const entry of entries) {
      let resolve!: () => void
      let reject!: (e: unknown) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      promise.catch(() => undefined) // reported to whoever awaits it; never unhandled
      const job: Job = { entry, path: entry.path, promise, resolve, reject }
      this.queued.push(job)
      this.jobs.set(entry.path, job)
    }
    this.pump()
  }

  /** Entries that are not on disk yet, shaped like tree entries. */
  pendingEntries(): Entry[] {
    return [...this.jobs.values()].map(({ entry, path }) => ({
      name: basename(path),
      path,
      kind: entry.kind,
    }))
  }

  pendingPaths(): string[] {
    return [...this.jobs.keys()]
  }

  has(path: string): boolean {
    return this.jobs.has(path)
  }

  remaining(): number {
    return this.jobs.size
  }

  status(): CopyProgress {
    return { done: this.settled - this.failed, failed: this.failed, total: this.total }
  }

  /**
   * Copies `path` next, ahead of everything else queued. Resolves once it is in the
   * workspace; rejects if its copy fails or the import is cancelled. Undefined when the
   * path is not pending.
   */
  promote(path: string): Promise<void> | undefined {
    const job = this.jobs.get(path)
    if (!job) return undefined
    const i = this.queued.indexOf(job)
    if (i > 0) {
      this.queued.splice(i, 1)
      this.queued.unshift(job)
      this.pump()
    }
    return job.promise
  }

  /** Stops starting new copies. Waiting callers are rejected. Used when a workspace is deleted. */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const job of this.queued) {
      this.jobs.delete(job.path)
      job.reject(new Error('Import cancelled'))
    }
    this.queued = []
    this.maybeIdle()
  }

  private pump(): void {
    while (!this.cancelled && this.reading < this.concurrency && this.queued.length > 0) {
      const job = this.queued.shift()!
      this.reading++
      void this.run(job)
    }
    this.maybeIdle()
  }

  private async run(job: Job): Promise<void> {
    try {
      if (job.entry.kind === 'dir') {
        await this.inOrder(() => this.fs.mkdir(job.path))
      } else {
        const bytes = await job.entry.read()
        if (this.cancelled) throw new Error('Import cancelled')
        await this.inOrder(() => this.fs.writeBytes(job.path, bytes))
      }
      this.complete(job, undefined)
    } catch (e) {
      this.complete(job, e)
    }
  }

  private complete(job: Job, error: unknown): void {
    this.jobs.delete(job.path)
    this.reading--
    this.settled++
    if (error === undefined) job.resolve()
    else {
      this.failed++
      job.reject(error)
    }
    this.onProgress?.(this.status())
    this.pump()
  }

  /** Writes go through one chain, in the order they were started. */
  private inOrder<T>(op: () => Promise<T>): Promise<T> {
    const next = this.writes.then(op)
    this.writes = next.catch(() => undefined)
    return next
  }

  private maybeIdle(): void {
    if (this.queued.length === 0 && this.reading === 0) this.idleResolve()
  }
}
