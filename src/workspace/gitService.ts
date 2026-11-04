import { Buffer } from 'buffer'
import git from 'isomorphic-git'
import type { GitStatus } from '../state/gitAtoms'
import { createGitFs, type GitFs } from './gitFs'

// isomorphic-git reaches for a global Buffer, which browsers do not have.
const g = globalThis as { Buffer?: typeof Buffer }
g.Buffer ??= Buffer

const DIR = '/'

/**
 * Read access to the git repository at the root of the linked folder. It tracks HEAD
 * and caches blobs by HEAD oid, so a file is read from the object store once per commit.
 */
export class GitService {
  private readonly fs: GitFs
  /** Undefined: not resolved yet. Null: no repository or no commits. */
  private oid: string | null | undefined
  private blobs = new Map<string, string | null>()

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

  /** Re-reads HEAD; the blob cache is dropped only when the commit changed. */
  async refreshHead(): Promise<string | null> {
    const oid = await this.resolveHead()
    if (oid !== this.oid) this.blobs.clear()
    this.oid = oid
    return oid
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

  /** True when the folder has a repository with at least one commit. */
  async hasHead(): Promise<boolean> {
    return (this.oid === undefined ? await this.refreshHead() : this.oid) !== null
  }

  /** Files that differ from HEAD (staged or not), from the status matrix. */
  async listChanged(): Promise<Map<string, GitStatus>> {
    const out = new Map<string, GitStatus>()
    if ((await this.refreshHead()) === null) return out
    let matrix: [string, number, number, number][]
    try {
      matrix = await git.statusMatrix({ fs: this.fs, dir: DIR })
    } catch {
      return out
    }
    for (const [file, head, workdir, stage] of matrix) {
      if (head === 0) {
        if (workdir === 2) out.set(file, stage === 0 ? 'untracked' : 'added')
      } else if (workdir === 0) out.set(file, 'deleted')
      else if (workdir === 2) out.set(file, 'modified')
      else if (stage !== 1) out.set(file, 'modified') // index differs from HEAD while the tree matches it
    }
    return out
  }
}
