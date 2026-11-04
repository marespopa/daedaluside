import git from 'isomorphic-git'
import { createGitFs } from './gitFs'
import { GitService } from './gitService'
import { prefetchBranch, ReviewError, type BranchPrefetch } from './branchPrefetch'
import { MemDisk } from './testing/memoryDisk'

const enc = (s: string) => new TextEncoder().encode(s)
const author = { name: 'T', email: 't@example.com' }

async function repo(defaultBranch: string, feature: boolean) {
  const disk = new MemDisk()
  const root = disk.handle() as unknown as FileSystemDirectoryHandle
  const fs = createGitFs(root)
  disk.setFile('a.txt', enc('one\ntwo\nthree\n'))
  await git.init({ fs, dir: '/', defaultBranch })
  await git.add({ fs, dir: '/', filepath: 'a.txt' })
  await git.commit({ fs, dir: '/', message: 'init', author })
  if (feature) {
    await git.branch({ fs, dir: '/', ref: 'feature', checkout: true })
    disk.setFile('a.txt', enc('one\nTWO\nthree\nfour\n'))
    disk.setFile('new.txt', enc('x\ny\n'))
    await git.add({ fs, dir: '/', filepath: 'a.txt' })
    await git.add({ fs, dir: '/', filepath: 'new.txt' })
    await git.commit({ fs, dir: '/', message: 'feat', author })
  }
  return new GitService(root)
}

describe('prefetchBranch', () => {
  it('emits the file list, then the same list with line totals', async () => {
    const svc = await repo('main', true)
    const calls: [BranchPrefetch, boolean][] = []
    await prefetchBranch(svc, (r, done) => calls.push([r, done]))
    // Committed files, the list with the working tree merged in, then the totals.
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const [first, d1] = calls[0]!
    const [last, d2] = calls[calls.length - 1]!
    expect(d1).toBe(false)
    expect(first.base).toBe('main')
    expect(first.branch).toBe('feature')
    expect(first.files.map((f: { path: string }) => f.path).sort()).toEqual(['a.txt', 'new.txt'])
    expect(first.stats).toEqual({})
    expect(d2).toBe(true)
    expect(last.stats['new.txt']).toEqual({ add: 2, del: 0 })
    expect(last.stats['a.txt']).toEqual({ add: 2, del: 1 })
  })

  it('reviews a trunk branch against itself', async () => {
    const svc = await repo('trunk', false)
    const emit = vi.fn()
    await prefetchBranch(svc, emit)
    expect(emit).toHaveBeenCalled()
    expect(emit.mock.calls[0]![0].base).toBe('trunk')
    expect(emit.mock.calls[0]![0].files).toEqual([])
  })

  it('rejects when no base branch can be found', async () => {
    const svc = await repo('foo', false)
    await expect(prefetchBranch(svc, vi.fn())).rejects.toBeInstanceOf(ReviewError)
  })
})
