import { diffTexts } from '../review/diff'
import { GitService, mapLimit, type BlobContent, type BranchFile } from './gitService'

/** What a review of the default base needs to open instantly. */
export interface BranchPrefetch {
  base: string
  branch: string
  mergeBase: string
  head: string
  files: BranchFile[]
  stats: Record<string, { add: number; del: number }>
  /** Committed files only: the working-tree overlay has not been merged in yet. */
  partial?: boolean
  /** Criss-cross history: the first of several merge bases was used. */
  multipleBases?: boolean
  /** Working-tree content behind `files`; the other thread has no object for these oids. */
  blobs?: [string, BlobContent][]
}

/** What to review: the default base, a named base (`origin/dev`), or HEAD against the disk. */
export interface BranchRequest {
  mode: 'base' | 'working'
  base?: string | undefined
  /** Totals the caller already has, by `mbOid|headOid`: those files are not diffed again. */
  known?: Record<string, { add: number; del: number }> | undefined
}

/** A problem the user can act on (unknown base, no repository), as opposed to a crash. */
export class ReviewError extends Error {}

/** Runs in a worker: the file list first (`done: false`), then the same list with line totals. */
export async function prefetchBranch(
  svc: GitService,
  emit: (r: BranchPrefetch, done: boolean) => void,
  req: BranchRequest = { mode: 'base' },
): Promise<void> {
  // Independent lookups run together instead of one after another.
  const requested = req.mode === 'base' ? req.base?.trim() : undefined
  const [has, defaultBase, branch] = await Promise.all([
    svc.hasHead(),
    req.mode === 'base' && !requested ? svc.defaultBase() : Promise.resolve(null),
    svc.currentBranch(),
  ])
  if (!has) throw new ReviewError('This folder is not a git repository with a commit.')
  let base = 'HEAD'
  let baseOid: string | null = null
  if (req.mode === 'base') {
    const named = requested || defaultBase
    if (!named) {
      throw new ReviewError(
        'No main, master or trunk branch found; name a base, for example :BranchReview origin/dev',
      )
    }
    base = named
    baseOid = await svc.resolveBase(base)
    if (!baseOid) throw new ReviewError(`Unknown base: ${base}`)
  }
  const send = (r: BranchPrefetch, done: boolean) =>
    emit({ ...r, blobs: svc.overlayBlobs(r.files) }, done)
  const res = await svc.branchChanges(baseOid, undefined, (files, mergeBase, head) =>
    send({ base, branch, mergeBase, head, files, stats: {}, partial: true }, false),
  )
  if (res.kind !== 'ok') throw new ReviewError(res.message)
  const stats: BranchPrefetch['stats'] = {}
  const todo: BranchFile[] = []
  for (const f of res.files) {
    const hit = req.known?.[`${f.mbOid}|${f.headOid}`]
    if (hit) stats[f.path] = hit
    else todo.push(f)
  }
  const out = (): BranchPrefetch => ({
    base,
    branch,
    mergeBase: res.mergeBase,
    head: res.head,
    files: res.files,
    stats: { ...stats },
    partial: false,
    multipleBases: res.multipleBases,
  })
  send(out(), todo.length === 0)
  if (todo.length === 0) return
  let n = 0
  await mapLimit(todo, 4, async (f) => {
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
    // Stream totals as they land so the header fills in instead of waiting for the last file.
    if (++n % 20 === 0 && n < todo.length) emit(out(), false)
  })
  send(out(), true)
}
