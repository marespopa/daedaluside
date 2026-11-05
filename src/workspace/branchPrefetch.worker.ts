/// <reference lib="webworker" />
import {
  prefetchBranch,
  ReviewError,
  type BranchPrefetch,
  type BranchRequest,
} from './branchPrefetch'
import { GitService } from './gitService'

export type ToWorker = {
  t: 'start'
  handle: FileSystemDirectoryHandle
  req?: BranchRequest
}
export type FromWorker =
  | { t: 'result'; result: BranchPrefetch; done: boolean }
  | { t: 'error'; message: string }
  | { t: 'end' }

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = (e: MessageEvent<ToWorker>) => {
  if (e.data.t !== 'start') return
  void prefetchBranch(
    new GitService(e.data.handle),
    (result, done) => post({ t: 'result', result, done }),
    e.data.req,
  )
    .catch((err) => {
      if (err instanceof ReviewError) post({ t: 'error', message: err.message })
    })
    .then(() => post({ t: 'end' }))
}
