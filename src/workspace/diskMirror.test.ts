import { DiskMirror, isAccessDenied } from './diskMirror'
import { MemDisk } from './testing/memoryDisk'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (u: Uint8Array | undefined) => (u ? new TextDecoder().decode(u) : undefined)

describe('DiskMirror', () => {
  it('writes a file into nested folders, creating them', async () => {
    const disk = new MemDisk()
    const m = new DiskMirror(disk.handle() as never)
    await m.writeFile('src/deep/a.ts', bytes('export {}'))
    expect(disk.dirs.has('src/deep')).toBe(true)
    expect(text(disk.files.get('src/deep/a.ts'))).toBe('export {}')
  })

  it('overwrites an existing file', async () => {
    const disk = new MemDisk()
    const m = new DiskMirror(disk.handle() as never)
    await m.writeFile('a.ts', bytes('one'))
    await m.writeFile('a.ts', bytes('two'))
    expect(text(disk.files.get('a.ts'))).toBe('two')
  })

  it('removes a folder with everything in it, and ignores what is already gone', async () => {
    const disk = new MemDisk()
    const m = new DiskMirror(disk.handle() as never)
    await m.writeFile('src/a.ts', bytes('a'))
    await m.writeFile('src/b/c.ts', bytes('c'))
    await m.writeFile('keep.md', bytes('k'))
    await m.remove('src')
    expect([...disk.files.keys()]).toEqual(['keep.md'])
    expect([...disk.dirs]).toEqual([''])
    await expect(m.remove('src/missing/x.ts')).resolves.toBeUndefined()
  })

  it('reports a lost permission as an access error, and writes nothing', async () => {
    const disk = new MemDisk()
    const m = new DiskMirror(disk.handle() as never)
    disk.access = 'prompt'
    const err = await m.writeFile('a.ts', bytes('x')).catch((e: unknown) => e)
    expect(isAccessDenied(err)).toBe(true)
    expect(disk.files.size).toBe(0)
    expect(await m.permission()).toBe('prompt')
  })
})
