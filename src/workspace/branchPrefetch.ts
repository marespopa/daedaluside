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
  const stats: BranchPrefetch['stats'] = {}
  // Totals by `mbOid|headOid`, shared between the committed files (counted while the
  // working-tree scan runs) and the final list, so a file is never diffed twice.
  const counted = new Map<string, Promise<{ add: number; del: number } | null>>()
  const count = (f: BranchFile) => {
    const key = `${f.mbOid}|${f.headOid}`
    let hit = counted.get(key)
    if (!hit) {
      hit = (async () => {
        try {
          const empty = { kind: 'text', text: '' } as const
          const [a, b] = await Promise.all([
            f.mbOid ? svc.readBlobAt(f.mbOid) : Promise.resolve(empty),
            f.headOid ? svc.readBlobAt(f.headOid) : Promise.resolve(empty),
          ])
          if (a.kind !== 'text' || b.kind !== 'text') return null
          const { stats: st } = diffTexts(a.text, b.text)
          return { add: st.added, del: st.removed }
        } catch {
          return null // an unreadable blob just has no totals
        }
      })()
      counted.set(key, hit)
    }
    return hit
  }
  let final = false
  let early: Promise<void> = Promise.resolve()
  const res = await svc.branchChanges(baseOid, undefined, (files, mergeBase, head) => {
    send({ base, branch, mergeBase, head, files, stats: {}, partial: true }, false)
    // The status scan is the slow part; count the committed files while it runs.
    const todo = files.filter((f) => !req.known?.[`${f.mbOid}|${f.headOid}`])
    let n = 0
    early = mapLimit(todo, 4, async (f) => {
      const t = await count(f)
      if (!t) return
      stats[f.path] = t
      if (!final && ++n % 20 === 0)
        send(
          { base, branch, mergeBase, head, files, stats: { ...stats }, partial: true },
          false,
        )
    })
  })
  if (res.kind !== 'ok') throw new ReviewError(res.message)
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
  await early
  final = true
  // Totals counted early may belong to a file the working tree has since changed: keep
  // only those whose blobs are the ones in the final list.
  for (const k of Object.keys(stats)) delete stats[k]
  const left: BranchFile[] = []
  for (const f of res.files) {
    const key = `${f.mbOid}|${f.headOid}`
    const hit = req.known?.[key]
    if (hit) stats[f.path] = hit
    else if (counted.has(key)) {
      const t = await counted.get(key)
      if (t) stats[f.path] = t
    } else left.push(f)
  }
  send(out(), left.length === 0)
  if (left.length === 0) return
  let n = 0
  await mapLimit(left, 4, async (f) => {
    const t = await count(f)
    if (t) stats[f.path] = t
    if (++n % 20 === 0 && n < left.length) emit(out(), false)
  })
  send(out(), true)
}
