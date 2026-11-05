import git from 'isomorphic-git'
import { createGitFs } from './gitFs'
import { GitService, MAX_TEXT_BYTES } from './gitService'
import { MemDisk } from './testing/memoryDisk'

const enc = (s: string) => new TextEncoder().encode(s)
const author = { name: 'T', email: 't@example.com' }

/** A repo with one commit holding a.txt and src/b.txt, built through the adapter itself. */
async function fixture() {
  const disk = new MemDisk()
  const root = disk.handle() as unknown as FileSystemDirectoryHandle
  const fs = createGitFs(root)
  disk.setFile('a.txt', enc('one\ntwo\nthree\n'))
  disk.setFile('src/b.txt', enc('b\n'))
  await git.init({ fs, dir: '/' })
  await git.add({ fs, dir: '/', filepath: 'a.txt' })
  await git.add({ fs, dir: '/', filepath: 'src/b.txt' })
  await git.commit({ fs, dir: '/', message: 'init', author })
  return { disk, root, fs, svc: new GitService(root) }
}

describe('createGitFs', () => {
  it('reads, writes and lists through the handle, including .git', async () => {
    const { disk, fs } = await fixture()
    expect(disk.dirs.has('.git')).toBe(true)
    expect(await fs.promises.readdir('/')).toContain('.git')
    await fs.promises.writeFile('/x/y.txt', 'hi')
    expect(await fs.promises.readFile('/x/y.txt', 'utf8')).toBe('hi')
    expect((await fs.promises.stat('/x')).isDirectory()).toBe(true)
    await fs.promises.unlink('/x/y.txt')
    await expect(fs.promises.stat('/x/y.txt')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.mkdir('/x')).rejects.toMatchObject({ code: 'EEXIST' })
  })
})

describe('GitService', () => {
  it('reads the HEAD text of a tracked file', async () => {
    const { svc } = await fixture()
    expect(await svc.getHeadBlob('a.txt')).toBe('one\ntwo\nthree\n')
    expect(await svc.getHeadBlob('src/b.txt')).toBe('b\n')
  })

  it('returns the HEAD text even after the working copy changed', async () => {
    const { svc, disk } = await fixture()
    disk.setFile('a.txt', enc('changed\n'))
    expect(await svc.getHeadBlob('a.txt')).toBe('one\ntwo\nthree\n')
  })

  it('returns null for untracked files', async () => {
    const { svc, disk } = await fixture()
    disk.setFile('new.txt', enc('n\n'))
    expect(await svc.getHeadBlob('new.txt')).toBeNull()
  })

  it('returns null for a folder that is not a repository', async () => {
    const disk = new MemDisk()
    disk.setFile('a.txt', enc('x'))
    const svc = new GitService(disk.handle() as unknown as FileSystemDirectoryHandle)
    expect(await svc.getHeadBlob('a.txt')).toBeNull()
    expect(await svc.hasHead()).toBe(false)
    expect((await svc.listChanged()).size).toBe(0)
  })

  it('lists modified, deleted and untracked files', async () => {
    const { svc, disk } = await fixture()
    expect((await svc.listChanged()).size).toBe(0)
    disk.setFile('a.txt', enc('changed, longer\n'))
    disk.files.delete('src/b.txt')
    disk.setFile('new.txt', enc('n\n'))
    svc.invalidateStatus()
    expect(Object.fromEntries(await svc.listChanged())).toEqual({
      'a.txt': 'modified',
      'src/b.txt': 'deleted',
      'new.txt': 'untracked',
    })
  })

  it('picks up a new commit on refreshHead', async () => {
    const { svc, disk, fs } = await fixture()
    expect(await svc.getHeadBlob('a.txt')).toBe('one\ntwo\nthree\n')
    disk.setFile('a.txt', enc('v2\n'))
    await git.add({ fs, dir: '/', filepath: 'a.txt' })
    await git.commit({ fs, dir: '/', message: 'two', author })
    await svc.refreshHead()
    expect(await svc.getHeadBlob('a.txt')).toBe('v2\n')
  })
})

describe('GitService staging', () => {
  async function matrix(fs: ReturnType<typeof createGitFs>, filepath: string) {
    const [row] = await git.statusMatrix({ fs, dir: '/', filepaths: [filepath] })
    return row!.slice(1)
  }

  it('reads the index text, null when the file is not in the index', async () => {
    const { svc, disk } = await fixture()
    expect(await svc.readIndex('a.txt')).toBe('one\ntwo\nthree\n')
    expect(await svc.readIndex('src/b.txt')).toBe('b\n')
    disk.setFile('new.txt', enc('n\n'))
    expect(await svc.readIndex('new.txt')).toBeNull()
  })

  it('stages given text as a blob and unstages it again', async () => {
    const { svc, disk, fs } = await fixture()
    disk.setFile('a.txt', enc('one\nTWO\nthree\nfour\n'))
    expect(await matrix(fs, 'a.txt')).toEqual([1, 2, 1]) // modified, unstaged
    await svc.writeIndex('a.txt', 'one\nTWO\nthree\n') // a partial stage: the first hunk only
    expect(await svc.readIndex('a.txt')).toBe('one\nTWO\nthree\n')
    expect(await matrix(fs, 'a.txt')).toEqual([1, 2, 3]) // staged, working copy differs
    await svc.resetIndex('a.txt')
    expect(await svc.readIndex('a.txt')).toBe('one\ntwo\nthree\n')
    expect(await matrix(fs, 'a.txt')).toEqual([1, 2, 1])
  })

  it('stages a new file and takes it out of the index again', async () => {
    const { svc, disk, fs } = await fixture()
    disk.setFile('src/new.txt', enc('n\n'))
    await svc.writeIndex('src/new.txt', 'n\n')
    expect(await svc.readIndex('src/new.txt')).toBe('n\n')
    expect(await matrix(fs, 'src/new.txt')).toEqual([0, 2, 2])
    await svc.resetIndex('src/new.txt')
    expect(await svc.readIndex('src/new.txt')).toBeNull()
    expect(await matrix(fs, 'src/new.txt')).toEqual([0, 2, 0])
  })

  it('fails with NotAllowedError on a read-only grant and leaves the index alone', async () => {
    const { svc, disk } = await fixture()
    disk.access = 'readonly'
    await expect(svc.writeIndex('a.txt', 'x\n')).rejects.toMatchObject({
      name: 'NotAllowedError',
    })
    expect(await svc.readIndex('a.txt')).toBe('one\ntwo\nthree\n')
  })
})

describe('GitService branch review', () => {
  /** main has the init commit; feature adds, edits and deletes files on top of it. */
  async function branched() {
    const f = await fixture()
    const { disk, fs } = f
    await git.branch({ fs, dir: '/', ref: 'main', checkout: false }).catch(() => {})
    const commit = async (message: string, files: Record<string, string | null>) => {
      for (const [p, text] of Object.entries(files)) {
        if (text === null) {
          disk.files.delete(p)
          await git.remove({ fs, dir: '/', filepath: p })
        } else {
          disk.setFile(p, p.endsWith('.bin') ? new Uint8Array([0, 1, 2]) : enc(text))
          await git.add({ fs, dir: '/', filepath: p })
        }
      }
      return git.commit({ fs, dir: '/', message, author })
    }
    const initial = await git.resolveRef({ fs, dir: '/', ref: 'HEAD' })
    await git.branch({ fs, dir: '/', ref: 'base', object: initial })
    await git.branch({ fs, dir: '/', ref: 'feature', checkout: true })
    await commit('feature', {
      'a.txt': 'one\nTWO\nthree\n',
      'src/new.ts': 'export {}\n',
      'src/b.txt': null,
      'img.bin': '',
    })
    return { ...f, commit, initial }
  }

  it('resolves branches, short oids and annotated tags to commits', async () => {
    const { svc, fs, initial } = await branched()
    expect(await svc.resolveBase('base')).toBe(initial)
    expect(await svc.resolveBase(initial.slice(0, 8))).toBe(initial)
    await git.annotatedTag({
      fs,
      dir: '/',
      ref: 'v1',
      object: initial,
      message: 'v1',
      tagger: author,
    })
    expect(await svc.resolveBase('v1')).toBe(initial)
    expect(await svc.resolveBase('nope')).toBeNull()
  })

  it('names the current branch and the default base', async () => {
    const { svc } = await branched()
    expect(await svc.currentBranch()).toBe('feature')
    // fixture's first branch is master or main depending on git config; either is a default.
    expect(['main', 'master']).toContain(await svc.defaultBase())
  })

  it('lists added, modified and deleted files against the merge base, sorted', async () => {
    const { svc, initial } = await branched()
    const res = await svc.branchChanges(initial)
    expect(res.kind).toBe('ok')
    if (res.kind !== 'ok') return
    expect(res.mergeBase).toBe(initial)
    expect(res.files.map((f) => [f.path, f.status])).toEqual([
      ['a.txt', 'M'],
      ['img.bin', 'A'],
      ['src/b.txt', 'D'],
      ['src/new.ts', 'A'],
    ])
    const a = res.files[0]!
    expect(a.mbOid).not.toBeNull()
    expect(a.headOid).not.toBeNull()
  })

  it('uses the merge base, not the base tip, when the base moved on', async () => {
    const { svc, fs, commit, initial } = await branched()
    await git.checkout({ fs, dir: '/', ref: 'base' })
    await commit('base moved', { 'other.txt': 'x\n' })
    const baseTip = await git.resolveRef({ fs, dir: '/', ref: 'base' })
    await git.checkout({ fs, dir: '/', ref: 'feature' })
    const res = await svc.branchChanges(baseTip)
    expect(res.kind === 'ok' && res.mergeBase).toBe(initial)
    expect(res.kind === 'ok' && res.files.some((f) => f.path === 'other.txt')).toBe(false)
  })

  it('reports no changes when the branch equals the base', async () => {
    const { svc, initial, fs } = await branched()
    await git.checkout({ fs, dir: '/', ref: 'base' })
    const res = await svc.branchChanges(initial)
    expect(res.kind === 'ok' && res.files).toEqual([])
  })

  it('reports unrelated histories as an error', async () => {
    const { svc, fs, disk } = await branched()
    await git.checkout({ fs, dir: '/', ref: 'feature' })
    // An orphan commit made with commit plumbing: a root commit that shares no history.
    const tree = await git.writeTree({ fs, dir: '/', tree: [] })
    const orphan = await git.writeCommit({
      fs,
      dir: '/',
      commit: {
        message: 'orphan',
        tree,
        parent: [],
        author: { ...author, timestamp: 1, timezoneOffset: 0 },
        committer: { ...author, timestamp: 1, timezoneOffset: 0 },
      },
    })
    void disk
    const res = await svc.branchChanges(orphan)
    expect(res).toEqual({ kind: 'error', message: 'No common ancestor with base' })
  })

  it('classes blobs as text, binary or large', async () => {
    const { svc, commit } = await branched()
    await commit('big', {
      'big.txt': 'x'.repeat(MAX_TEXT_BYTES + 1),
      'lock.json': 'y\n'.repeat(1024 * 1024),
    })
    const res = await svc.branchChanges((await svc.resolveBase('base'))!)
    if (res.kind !== 'ok') throw new Error('expected ok')
    const byPath = Object.fromEntries(res.files.map((f) => [f.path, f]))
    expect(await svc.readBlobAt(byPath['a.txt']!.headOid!)).toEqual({
      kind: 'text',
      text: 'one\nTWO\nthree\n',
    })
    expect((await svc.readBlobAt(byPath['img.bin']!.headOid!)).kind).toBe('binary')
    expect((await svc.readBlobAt(byPath['big.txt']!.headOid!)).kind).toBe('large')
    // A multi-megabyte text file is still reviewable.
    expect((await svc.readBlobAt(byPath['lock.json']!.headOid!)).kind).toBe('text')
  })
})
