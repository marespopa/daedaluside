import git from 'isomorphic-git'
import { createGitFs } from './gitFs'
import { GitService } from './gitService'
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
    await expect(svc.writeIndex('a.txt', 'x\n')).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(await svc.readIndex('a.txt')).toBe('one\ntwo\nthree\n')
  })
})
