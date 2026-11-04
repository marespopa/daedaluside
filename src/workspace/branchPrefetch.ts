import { diffTexts } from '../review/diff'
import { GitService, mapLimit, type BranchFile } from './gitService'

/** What a review of the default base needs to open instantly. */
export interface BranchPrefetch {
  base: string
  branch: string
  mergeBase: string
  head: string
  files: BranchFile[]
  stats: Record<string, { add: number; del: number }>
}

/** Runs in a worker: the file list first (`done: false`), then the same list with line totals. */
export async function prefetchBranch(
  svc: GitService,
  emit: (r: BranchPrefetch, done: boolean) => void,
): Promise<void> {
  if (!(await svc.hasHead())) return
  const base = await svc.defaultBase()
  if (!base) return
  const baseOid = await svc.resolveBase(base)
  if (!baseOid) return
  const branch = await svc.currentBranch()
  const res = await svc.branchChanges(baseOid, undefined, (files, mergeBase, head) =>
    emit({ base, branch, mergeBase, head, files, stats: {} }, false),
  )
  if (res.kind !== 'ok') return
  const stats: BranchPrefetch['stats'] = {}
  const out = () => ({
    base,
    branch,
    mergeBase: res.mergeBase,
    head: res.head,
    files: res.files,
    stats: { ...stats },
  })
  emit(out(), res.files.length === 0)
  if (res.files.length === 0) return
  await mapLimit(res.files, 4, async (f) => {
    try {
      const empty = { kind: 'text', text: '' } as const
      const [a, b] = await Promise.all([
        f.mbOid ? svc.readBlobAt(f.mbOid) : Promise.resolve(empty),
        f.headOid ? svc.readBlobAt(f.headOid) : Promise.resolve(empty),
      ])
      if (a.kind === 'text' && b.kind === 'text') {
        const { stats: st } = diffTexts(a.text, b.text)
        stats[f.path] = { add: st.added, del: st.removed }
      }
    } catch {
      // an unreadable blob just has no totals
    }
  })
  emit(out(), true)
}
