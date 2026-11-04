import type { BranchPrefetch, BranchRequest } from './branchPrefetch'
import type { FromWorker, ToWorker } from './branchPrefetch.worker'

/**
 * Reads the default-base branch review in a Web Worker as soon as a folder opens, so the
 * review is ready by the time it is asked for. Without Workers (tests) it does nothing.
 */
export class BranchPrefetchService {
  private worker: Worker | null = null
  /** Called when `dispose` is what ends a running review (not a finish or a failure). */
  private cancel: (() => void) | null = null

  /**
   * Starts a review (the default base unless `req` says otherwise); `onResult` gets the
   * file list, then the list with totals. `onError` gets a message meant for the user.
   * Returns false when no worker could be started (`onEnd` has then been called).
   */
  start(
    handle: FileSystemDirectoryHandle,
    onResult: (r: BranchPrefetch, done: boolean) => void,
    onEnd: () => void,
    req?: BranchRequest,
    onError?: (message: string) => void,
    onCancel?: () => void,
  ): boolean {
    this.dispose()
    if (typeof Worker === 'undefined') {
      onEnd()
      return false
    }
    try {
      const w = new Worker(new URL('./branchPrefetch.worker.ts', import.meta.url), {
        type: 'module',
      })
      this.worker = w
      this.cancel = onCancel ?? null
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        if (this.worker !== w) return
        if (e.data.t === 'result') onResult(e.data.result, e.data.done)
        else if (e.data.t === 'error') onError?.(e.data.message)
        else {
          this.stop()
          onEnd()
        }
      }
      const failed = () => {
        if (this.worker !== w) return
        this.stop()
        onEnd()
      }
      w.onerror = failed
      w.onmessageerror = failed
      const m: ToWorker = req ? { t: 'start', handle, req } : { t: 'start', handle }
      w.postMessage(m)
      return true
    } catch {
      this.stop()
      onEnd()
      return false
    }
  }

  /** Ends a running review from outside; its `onCancel` runs so no caller waits forever. */
  dispose() {
    const cancel = this.cancel
    this.stop()
    cancel?.()
  }

  private stop() {
    this.cancel = null
    this.worker?.terminate()
    this.worker = null
  }
}
