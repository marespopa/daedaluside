import type { BranchPrefetch } from './branchPrefetch'
import type { FromWorker, ToWorker } from './branchPrefetch.worker'

/**
 * Reads the default-base branch review in a Web Worker as soon as a folder opens, so the
 * review is ready by the time it is asked for. Without Workers (tests) it does nothing.
 */
export class BranchPrefetchService {
  private worker: Worker | null = null

  /** Starts a prefetch; `onResult` gets the file list, then the list with totals. */
  start(
    handle: FileSystemDirectoryHandle,
    onResult: (r: BranchPrefetch, done: boolean) => void,
    onEnd: () => void,
  ) {
    this.dispose()
    if (typeof Worker === 'undefined') return onEnd()
    try {
      const w = new Worker(new URL('./branchPrefetch.worker.ts', import.meta.url), {
        type: 'module',
      })
      this.worker = w
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        if (this.worker !== w) return
        if (e.data.t === 'result') onResult(e.data.result, e.data.done)
        else {
          this.dispose()
          onEnd()
        }
      }
      w.onerror = () => {
        if (this.worker !== w) return
        this.dispose()
        onEnd()
      }
      const m: ToWorker = { t: 'start', handle }
      w.postMessage(m)
    } catch {
      this.dispose()
      onEnd()
    }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
  }
}
