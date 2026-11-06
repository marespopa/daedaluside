import git from 'isomorphic-git'
import { createGitFs } from './gitFs'
import { scanStatus } from './fastStatus'
import { MemDisk } from './testing/memoryDisk'

const enc = (s: string) => new TextEncoder().encode(s)
const author = { name: 'T', email: 't@example.com' }
const sorted = (rows: readonly (readonly [string, number, number, number])[]) =>
  rows.map((r) => r.join(',')).sort()

describe('scanStatus', () => {
  it('matches git.statusMatrix for edits, deletions, staged and untracked files', async () => {
    const disk = new MemDisk()
    const fs = createGitFs(disk.handle() as unknown as FileSystemDirectoryHandle)
    disk.setFile('.gitignore', enc('dist/\n*.log\n'))
    disk.setFile('keep.txt', enc('keep\n'))
    disk.setFile('edit.txt', enc('one\n'))
    disk.setFile('gone.txt', enc('bye\n'))
    disk.setFile('src/deep/a.ts', enc('a\n'))
    await git.init({ fs, dir: '/', defaultBranch: 'main' })
    for (const f of ['.gitignore', 'keep.txt', 'edit.txt', 'gone.txt', 'src/deep/a.ts'])
      await git.add({ fs, dir: '/', filepath: f })
    await git.commit({ fs, dir: '/', message: 'init', author })

    disk.setFile('edit.txt', enc('two\n'))
    disk.files.delete('gone.txt')
    disk.setFile('staged.txt', enc('s\n'))
    await git.add({ fs, dir: '/', filepath: 'staged.txt' })
    disk.setFile('src/deep/new.ts', enc('n\n'))
    disk.setFile('dist/out.js', enc('x\n'))
    disk.setFile('debug.log', enc('x\n'))
    disk.setFile('node_modules/p/i.js', enc('x\n'))

    const head = await git.resolveRef({ fs, dir: '/', ref: 'HEAD' })
    const fast = await scanStatus(fs, {}, head, (filepath) =>
      git.isIgnored({ fs, dir: '/', filepath }),
    )
    // [path, HEAD, workdir, stage]; unchanged files are left out. `node_modules` is never
    // walked, and ignored files (`dist/`, `*.log`) are not reported.
    const changed = fast.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1))
    expect(sorted(changed)).toEqual([
      'edit.txt,1,2,1',
      'gone.txt,1,0,1',
      'src/deep/new.ts,0,2,0',
      'staged.txt,0,2,2',
    ])
  })
})
