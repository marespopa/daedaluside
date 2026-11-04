/// <reference lib="webworker" />
import { prefetchBranch, type BranchPrefetch } from './branchPrefetch'
import { GitService } from './gitService'

export type ToWorker = { t: 'start'; handle: FileSystemDirectoryHandle }
export type FromWorker =
  | { t: 'result'; result: BranchPrefetch; done: boolean }
  | { t: 'end' }

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = (e: MessageEvent<ToWorker>) => {
  if (e.data.t !== 'start') return
  void prefetchBranch(new GitService(e.data.handle), (result, done) =>
    post({ t: 'result', result, done }),
  )
    .catch(() => {})
    .then(() => post({ t: 'end' }))
}
