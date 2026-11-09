import { Buffer } from 'buffer'
import git from 'isomorphic-git'
import type { GitStatus } from '../state/gitAtoms'
import { scanStatus } from './fastStatus'
import { createGitFs, type GitFs } from './gitFs'

// isomorphic-git reaches for a global Buffer, which browsers do not have.
const g = globalThis as { Buffer?: typeof Buffer }
g.Buffer ??= Buffer

const DIR = '/'
/** Conventional names of a repository's main line, tried after the remote's own default. */
export const DEFAULT_BASES = ['main', 'master', 'trunk', 'develop', 'dev']
/** Text above this is not decoded for review (manifests and lockfiles stay well below it). */
export const MAX_TEXT_BYTES = 16 * 1024 * 1024

export interface BranchFile {
  path: string
  status: 'A' | 'M' | 'D'
  /** Blob oid at the merge base (null when added) and at HEAD (null when deleted). */
  mbOid: string | null
  headOid: string | null
}

export type BranchChanges =
  | {
      kind: 'ok'
      mergeBase: string
      head: string
      files: BranchFile[]
      multipleBases: boolean
    }
  | { kind: 'error'; message: string }

export type BlobContent =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; size: number }
  | { kind: 'large'; size: number }

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Folds one statusMatrix row (file, HEAD, workdir, stage) into the changed-file map. */
function applyRow(
  out: Map<string, GitStatus>,
  row: readonly [string, number, number, number],
) {
  const [file, head, workdir, stage] = row
  if (head === 0) {
    if (workdir === 2) out.set(file, stage === 0 ? 'untracked' : 'added')
  } else if (workdir === 0) out.set(file, 'deleted')
  else if (workdir === 2) out.set(file, 'modified')
  else if (stage !== 1) out.set(file, 'modified') // index differs from HEAD while the tree matches it
}

function classifyBlob(blob: Uint8Array): BlobContent {
  if (blob.length > MAX_TEXT_BYTES) return { kind: 'large', size: blob.length }
  if (blob.includes(0)) return { kind: 'binary', size: blob.length }
  return { kind: 'text', text: new TextDecoder().decode(blob) }
}

/**
 * Read access to the git repository at the root of the linked folder. It tracks HEAD
 * and caches blobs by HEAD oid, so a file is read from the object store once per commit.
 */
export class GitService {
  private readonly fs: GitFs
  /** Undefined: not resolved yet. Null: no repository or no commits. */
  private oid: string | null | undefined
  private blobs = new Map<string, string | null>()
  /** Shared isomorphic-git cache, so pack indexes are parsed once. */
  private readonly cache: object = {}
  /** Branch-review blobs by oid; an oid names its content, so this never goes stale. */
  private blobsByOid = new Map<string, BlobContent>()

  constructor(root: FileSystemDirectoryHandle) {
    this.fs = createGitFs(root)
  }

  private async resolveHead(): Promise<string | null> {
    try {
      return await git.resolveRef({ fs: this.fs, dir: DIR, ref: 'HEAD' })
    } catch {
      return null
    }
  }

  /** Re-reads HEAD; the blob cache and the status scan are dropped only when the commit changed. */
  async refreshHead(): Promise<string | null> {
    const oid = await this.resolveHead()
    if (oid !== this.oid) {
      this.blobs.clear()
      // A commit moves HEAD under a scan taken against the old one.
      if (this.oid !== undefined) this.changed = null
    }
    this.oid = oid
    return oid
  }

  /** The last HEAD commit seen: undefined before the first read, null without commits. */
  knownHead(): string | null | undefined {
    return this.oid
  }

  /**
   * The text of `path` at HEAD, or null when there is no repository, no commit, the
   * file is untracked, or it is not text. Callers treat null as "all lines added".
   */
  async getHeadBlob(path: string): Promise<string | null> {
    const oid = this.oid === undefined ? await this.refreshHead() : this.oid
    if (oid === null) return null
    if (this.blobs.has(path)) return this.blobs.get(path)!
    let text: string | null = null
    try {
      const { blob } = await git.readBlob({ fs: this.fs, dir: DIR, oid, filepath: path })
      if (!blob.includes(0)) text = new TextDecoder().decode(blob)
    } catch {
      text = null
    }
    this.blobs.set(path, text)
    return text
  }

  /** The text staged for `path`, or null when the index has no entry for it (or not text). */
  async readIndex(path: string): Promise<string | null> {
    let oid: string | null = null
    try {
      await git.walk({
        fs: this.fs,
        dir: DIR,
        trees: [git.STAGE()],
        map: async (filepath, [entry]) => {
          if (filepath === '.') return undefined
          if (filepath === path) {
            oid = (await entry?.oid()) ?? null
            return null
          }
          // Descend only into the folders on the way to `path`.
          return path.startsWith(`${filepath}/`) ? undefined : null
        },
      })
    } catch {
      return null
    }
    if (oid === null) return null
    try {
      const { blob } = await git.readBlob({ fs: this.fs, dir: DIR, oid })
      return blob.includes(0) ? null : new TextDecoder().decode(blob)
    } catch {
      return null
    }
  }

  /** Stages `text` as the content of `path`: writes the blob and points the index entry at it. */
  async writeIndex(path: string, text: string): Promise<void> {
    const oid = await git.writeBlob({
      fs: this.fs,
      dir: DIR,
      blob: new TextEncoder().encode(text),
    })
    await git.updateIndex({ fs: this.fs, dir: DIR, filepath: path, oid, add: true })
  }

  /** Puts the index entry of `path` back to what HEAD has; a file HEAD lacks leaves the index. */
  async resetIndex(path: string): Promise<void> {
    const oid = await this.refreshHead()
    let tracked = false
    if (oid !== null) {
      try {
        await git.readBlob({ fs: this.fs, dir: DIR, oid, filepath: path })
        tracked = true
      } catch {
        tracked = false
      }
    }
    if (tracked) await git.resetIndex({ fs: this.fs, dir: DIR, filepath: path })
    else await git.remove({ fs: this.fs, dir: DIR, filepath: path })
  }

  /** Drops `path` from the index (staging the removal of a file, or unstaging a new one). */
  async removeFromIndex(path: string): Promise<void> {
    await git.remove({ fs: this.fs, dir: DIR, filepath: path })
  }

  // --- Branch review: base...HEAD -------------------------------------------------

  /** Resolves a branch, tag, remote ref or (short) oid to a commit oid; null when unknown. */
  async resolveBase(ref: string): Promise<string | null> {
    const fs = this.fs
    let oid: string | null = null
    if (/^[0-9a-f]{4,40}$/i.test(ref)) {
      try {
        oid = await git.expandOid({ fs, dir: DIR, oid: ref.toLowerCase() })
      } catch {
        oid = null
      }
    }
    if (oid === null) {
      try {
        oid = await git.resolveRef({ fs, dir: DIR, ref })
      } catch {
        return null
      }
    }
    // An annotated tag resolves to the tag object; peel it to the commit it points at.
    for (let i = 0; i < 5; i++) {
      try {
        const { tag } = await git.readTag({ fs, dir: DIR, oid, cache: this.cache })
        oid = tag.object
      } catch {
        break
      }
    }
    return oid
  }

  /**
   * The default base. The remote's own default (`origin/HEAD`) and `init.defaultBranch`
   * come first, so a repository whose trunk is called `trunk` (or anything else) works
   * without configuration; then the usual names, local before `origin/`.
   */
  async defaultBase(): Promise<string | null> {
    const named: string[] = []
    try {
      const target = await git.resolveRef({
        fs: this.fs,
        dir: DIR,
        ref: 'refs/remotes/origin/HEAD',
        depth: 1,
      })
      // A symbolic ref reads back as "ref: refs/remotes/origin/<branch>".
      const m = /^(?:ref:\s*)?refs\/remotes\/origin\/(.+?)\s*$/.exec(target)
      if (m) named.push(m[1]!)
    } catch {
      /* no origin/HEAD: a repository that was not cloned, or a bare remote */
    }
    try {
      const configured = await git.getConfig({
        fs: this.fs,
        dir: DIR,
        path: 'init.defaultBranch',
      })
      if (typeof configured === 'string' && configured) named.push(configured)
    } catch {
      /* no config */
    }
    const candidates = [
      ...named.flatMap((n) => [n, `origin/${n}`]),
      ...DEFAULT_BASES,
      ...DEFAULT_BASES.map((n) => `origin/${n}`),
    ]
    for (const name of candidates) {
      if ((await this.resolveBase(name)) !== null) return name
    }
    return null
  }

  /** The name of the checked-out branch, or "HEAD" when detached. */
  async currentBranch(): Promise<string> {
    try {
      return (await git.currentBranch({ fs: this.fs, dir: DIR })) || 'HEAD'
    } catch {
      return 'HEAD'
    }
  }

  /**
   * The cumulative changeset `merge-base(base, HEAD)..HEAD`, by walking both trees and
   * pruning every directory whose oid is equal. Renames are not detected (A plus D).
   */
  async branchChanges(
    baseOid: string | null,
    signal?: { cancelled: boolean },
    /** Called with the committed changes before the (slower) working-tree scan is merged in. */
    onCommitted?: (files: BranchFile[], mergeBase: string, head: string) => void,
  ): Promise<BranchChanges> {
    const head = await this.refreshHead()
    if (head === null) return { kind: 'error', message: 'No commits yet' }
    // The status scan is the slow part: let it run alongside the tree walk.
    void this.listChanged().catch(() => {})
    if (baseOid === null) {
      // Working-tree mode: HEAD against what is on disk.
      const files = await this.overlayWorkingTree(head, [], signal)
      files.sort((x, y) => x.path.localeCompare(y.path))
      return { kind: 'ok', mergeBase: head, head, files, multipleBases: false }
    }
    let bases: string[]
    try {
      bases = await git.findMergeBase({
        fs: this.fs,
        dir: DIR,
        oids: [baseOid, head],
        cache: this.cache,
      })
    } catch {
      bases = []
    }
    if (bases.length === 0)
      return { kind: 'error', message: 'No common ancestor with base' }
    const mergeBase = bases[0]!
    const files: BranchFile[] = []
    try {
      await git.walk({
        fs: this.fs,
        dir: DIR,
        cache: this.cache,
        trees: [git.TREE({ ref: mergeBase }), git.TREE({ ref: head })],
        map: async (path, [a, b]) => {
          if (signal?.cancelled) throw new Error('cancelled')
          if (path === '.') return undefined
          const [ta, tb] = [await a?.type(), await b?.type()]
          if (ta === 'commit' || tb === 'commit') return null // submodules
          const [oa, ob] = [(await a?.oid()) ?? null, (await b?.oid()) ?? null]
          if (oa === ob) return null // identical blob or whole subtree
          const dirA = ta === 'tree'
          const dirB = tb === 'tree'
          if (dirA || dirB) {
            // A directory on one side and a file on the other: report the file side here
            // and let the walk descend for the directory side.
            if (!dirA && a)
              files.push({ path, status: b ? 'M' : 'D', mbOid: oa, headOid: null })
            if (!dirB && b)
              files.push({ path, status: a ? 'M' : 'A', mbOid: null, headOid: ob })
            return undefined
          }
          files.push({
            path,
            status: !a ? 'A' : !b ? 'D' : 'M',
            mbOid: oa,
            headOid: ob,
          })
          return null
        },
      })
    } catch (e) {
      if (signal?.cancelled) return { kind: 'error', message: 'Cancelled' }
      return {
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not read branch',
      }
    }
    onCommitted?.(
      [...files].sort((x, y) => x.path.localeCompare(y.path)),
      mergeBase,
      head,
    )
    // Uncommitted work counts as part of the branch: overlay the working tree on HEAD.
    const merged = await this.overlayWorkingTree(mergeBase, files, signal)
    merged.sort((x, y) => x.path.localeCompare(y.path))
    return { kind: 'ok', mergeBase, head, files: merged, multipleBases: bases.length > 1 }
  }

  /**
   * Replaces each dirty path's HEAD side with the working-tree file. The content is hashed
   * and cached under its would-be blob oid, so readers need no special case.
   */
  private async overlayWorkingTree(
    mergeBase: string,
    committed: BranchFile[],
    signal?: { cancelled: boolean },
  ): Promise<BranchFile[]> {
    const dirty = await this.listChanged()
    if (dirty.size === 0) return committed
    const byPath = new Map(committed.map((f) => [f.path, f]))
    await mapLimit([...dirty.keys()], 6, async (path) => {
      if (signal?.cancelled) return
      const prior = byPath.get(path)
      let mbOid: string | null = prior ? prior.mbOid : null
      if (!prior) {
        try {
          mbOid = (
            await git.readBlob({
              fs: this.fs,
              dir: DIR,
              oid: mergeBase,
              filepath: path,
              cache: this.cache,
            })
          ).oid
        } catch {
          mbOid = null
        }
      }
      let bytes: Uint8Array | null
      try {
        const raw = await this.fs.promises.readFile(`/${path}`)
        bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
      } catch {
        bytes = null
      }
      let headOid: string | null = null
      if (bytes) {
        headOid = (await git.hashBlob({ object: bytes })).oid
        this.overlayOids.add(headOid)
        if (!this.blobsByOid.has(headOid))
          this.blobsByOid.set(headOid, classifyBlob(bytes))
      }
      if (mbOid === headOid) {
        byPath.delete(path)
        return
      }
      byPath.set(path, {
        path,
        status: !mbOid ? 'A' : !headOid ? 'D' : 'M',
        mbOid,
        headOid,
      })
    })
    return [...byPath.values()]
  }

  /** Working-tree blobs have no object in the repository, so they are cached under their oid. */
  private readonly overlayOids = new Set<string>()

  /** The working-tree content behind `files`' HEAD side, to hand to another thread's service. */
  overlayBlobs(files: readonly BranchFile[]): [string, BlobContent][] {
    const out: [string, BlobContent][] = []
    for (const f of files) {
      const oid = f.headOid
      const hit = oid && this.overlayOids.has(oid) ? this.blobsByOid.get(oid) : undefined
      if (oid && hit) out.push([oid, hit])
    }
    return out
  }

  /** Adopts blobs another thread read from the working tree. */
  primeBlobs(blobs: readonly [string, BlobContent][]) {
    // An oid names its content, so a shipped copy replaces a cached read failure.
    for (const [oid, c] of blobs) this.blobsByOid.set(oid, c)
  }

  /** The content behind a blob oid, classed so callers can show a placeholder. */
  async readBlobAt(oid: string): Promise<BlobContent> {
    const hit = this.blobsByOid.get(oid)
    if (hit) return hit
    let out: BlobContent
    try {
      const { blob } = await git.readBlob({
        fs: this.fs,
        dir: DIR,
        oid,
        cache: this.cache,
      })
      out = classifyBlob(blob)
    } catch {
      out = { kind: 'binary', size: 0 }
    }
    this.blobsByOid.set(oid, out)
    return out
  }

  /** True when the folder has a repository with at least one commit. */
  async hasHead(): Promise<boolean> {
    return (this.oid === undefined ? await this.refreshHead() : this.oid) !== null
  }

  private changed: Promise<Map<string, GitStatus>> | null = null

  /** Drops the cached status; call after anything that may have changed the files or index. */
  invalidateStatus() {
    this.changed = null
  }

  private changedAt = 0

  /** Drops the cached status only when it is older than `ms`. */
  invalidateStatusIfOlder(ms: number) {
    if (Date.now() - this.changedAt > ms) this.changed = null
  }

  /**
   * Files that differ from HEAD (staged or not). The scan is expensive, so concurrent and
   * repeat callers share one result until `invalidateStatus()`.
   */
  listChanged(): Promise<Map<string, GitStatus>> {
    if (!this.changed) {
      const run = this.scanChanged()
      this.changedAt = Date.now()
      this.changed = run
      // A failed scan must not stick.
      run.catch(() => {
        if (this.changed === run) this.changed = null
      })
    }
    return this.changed
  }

  private async scanChanged(): Promise<Map<string, GitStatus>> {
    const out = new Map<string, GitStatus>()
    const head = await this.refreshHead()
    if (head === null) return out
    let matrix: readonly (readonly [string, number, number, number])[]
    try {
      matrix = await scanStatus(this.fs, this.cache, head, (filepath) =>
        git.isIgnored({ fs: this.fs, dir: DIR, filepath }),
      )
    } catch {
      // The fast scan could not read the repository: let isomorphic-git try.
      try {
        matrix = await git.statusMatrix({ fs: this.fs, dir: DIR })
      } catch {
        return out
      }
    }
    for (const row of matrix) applyRow(out, row)
    return out
  }

  /**
   * Re-reads the status of just `paths` into the cached scan, so a save costs a stat of
   * one file instead of a walk of the whole tree. Without a scan to patch, or when HEAD
   * moved, the next `listChanged()` does the full scan instead.
   */
  async patchChanged(paths: readonly string[]): Promise<void> {
    const prior = this.changed
    if (!prior) return
    const head = this.oid
    let base: Map<string, GitStatus>
    try {
      base = await prior
    } catch {
      return
    }
    if (this.changed !== prior || (await this.resolveHead()) !== head) {
      this.changed = null
      return
    }
    const next = new Map(base)
    for (const p of paths) next.delete(p)
    try {
      const matrix = await git.statusMatrix({
        fs: this.fs,
        dir: DIR,
        filepaths: [...paths],
      })
      for (const row of matrix) applyRow(next, row)
    } catch {
      this.changed = null
      return
    }
    if (this.changed === prior) {
      this.changed = Promise.resolve(next)
      this.changedAt = Date.now()
    }
  }
}
