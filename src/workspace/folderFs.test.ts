import { FolderFS } from './folderFs'
import { runFSContract } from './fsContract'
import { MemDisk } from './testing/memoryDisk'

runFSContract('FolderFS', () => new FolderFS(new MemDisk().handle() as never))

describe('FolderFS focused tests', () => {
  it('keeps old content when a write fails before close', async () => {
    const disk = new MemDisk()
    const fs = new FolderFS(disk.handle() as never)
    await fs.write('f.txt', 'old content')
    disk.breakFile('f.txt')
    await expect(fs.write('f.txt', 'new content')).rejects.toThrow()
    expect(await fs.read('f.txt')).toBe('old content')
  })

  it('overwrites with shorter content without leaving stale tail bytes', async () => {
    const fs = new FolderFS(new MemDisk().handle() as never)
    await fs.write('f.txt', 'long content here')
    await fs.write('f.txt', 'short')
    expect(await fs.read('f.txt')).toBe('short')
    await fs.write('f.txt', '')
    expect(await fs.read('f.txt')).toBe('')
    expect((await fs.stat('f.txt'))!.size).toBe(0)
  })
})
