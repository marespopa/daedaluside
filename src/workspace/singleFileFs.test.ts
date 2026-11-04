import { describe, expect, it } from 'vitest'
import { SingleFileFS } from './singleFileFs'
import { MemDisk } from './testing/memoryDisk'
import { FSError } from './types'

/** Maps a rejection to the FSError code (or a marker for unexpected errors). */
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof FSError ? (`${e.code}` as string) : 'other'
  }
  return 'none'
}

describe('SingleFileFS', () => {
  const make = (name = 'notes.md', text = 'hello') => {
    const disk = new MemDisk()
    const handle = disk.fileHandle(name, new TextEncoder().encode(text))
    return { disk, handle, fs: new SingleFileFS(handle as never) }
  }

  it('lists the root holding exactly the one file, with its size', async () => {
    const { fs } = make('notes.md', 'hello')
    expect(await fs.list('')).toEqual([
      { name: 'notes.md', path: 'notes.md', kind: 'file', size: 5 },
    ])
    expect(await fs.listAll()).toEqual(await fs.list(''))
  })

  it('stats the root as a dir, the file as a file, nothing else', async () => {
    const { fs } = make()
    expect(await fs.stat('')).toEqual({ name: '', path: '', kind: 'dir' })
    expect(await fs.stat('notes.md')).toEqual({
      name: 'notes.md',
      path: 'notes.md',
      kind: 'file',
      size: 5,
    })
    expect(await fs.stat('other.md')).toBeNull()
    expect(await fs.stat('notes.md/child')).toBeNull()
  })

  it('reads text and bytes', async () => {
    const { fs } = make('notes.md', 'héllo')
    expect(await fs.read('notes.md')).toBe('héllo')
    expect(Array.from(await fs.readBytes('notes.md'))).toEqual(
      Array.from(new TextEncoder().encode('héllo')),
    )
  })

  it('writes text and bytes, replacing the file whole', async () => {
    const { fs, disk } = make('notes.md', 'long content here')
    await fs.write('notes.md', 'short')
    expect(new TextDecoder().decode(disk.files.get('notes.md'))).toBe('short')

    const bytes = new Uint8Array([0, 255, 1, 254])
    await fs.writeBytes('notes.md', bytes)
    expect(Array.from(disk.files.get('notes.md')!)).toEqual(Array.from(bytes))
  })

  it('overwrites with shorter content without leaving stale tail bytes', async () => {
    const { fs, disk } = make('f.txt', 'long content here')
    await fs.write('f.txt', 'ok')
    expect(disk.files.get('f.txt')!.byteLength).toBe(2)
    await fs.write('f.txt', '')
    expect(disk.files.get('f.txt')!.byteLength).toBe(0)
  })

  it('keeps old content when a write fails part-way', async () => {
    const { fs, disk } = make('notes.md', 'old')
    expect(await code(fs.write('nope.md', 'x'))).toBe('ENOENT')
    expect(new TextDecoder().decode(disk.files.get('notes.md')!)).toBe('old')
  })

  it('serializes writes', async () => {
    const { fs, disk } = make('notes.md', '')
    await Promise.all(Array.from({ length: 6 }, (_, i) => fs.write('notes.md', `v${i}`)))
    expect(new TextDecoder().decode(disk.files.get('notes.md')!)).toBe('v5')
  })

  it('rejects the root and paths under the file with typed errors', async () => {
    const { fs } = make('notes.md')
    expect(await code(fs.read(''))).toBe('EISDIR')
    expect(await code(fs.readBytes(''))).toBe('EISDIR')
    expect(await code(fs.write('', 'x'))).toBe('EISDIR')
    expect(await code(fs.read('notes.md/x'))).toBe('ENOTDIR')
    expect(await code(fs.write('notes.md/x', 'x'))).toBe('ENOTDIR')
    expect(await code(fs.list('notes.md'))).toBe('ENOTDIR')
    expect(await code(fs.list('notes.md/sub'))).toBe('ENOTDIR')
    expect(await code(fs.list('missing'))).toBe('ENOENT')
    expect(await code(fs.read('missing'))).toBe('ENOENT')
    expect(await code(fs.write('missing', 'x'))).toBe('ENOENT')
  })

  it('cannot grow or reshape: mkdir, remove and rename are EINVAL', async () => {
    const { fs } = make('notes.md')
    expect(await code(fs.mkdir('d'))).toBe('EINVAL')
    expect(await code(fs.remove('notes.md'))).toBe('EINVAL')
    expect(await code(fs.remove(''))).toBe('EINVAL')
    expect(await code(fs.rename('notes.md', 'other.md'))).toBe('EINVAL')
    expect(await fs.stat('notes.md')).toMatchObject({ kind: 'file' })
  })

  it('reflects external content changes through the handle', async () => {
    const { disk, fs } = make('notes.md', 'a')
    disk.files.set('notes.md', new TextEncoder().encode('grown'))
    expect((await fs.list(''))[0]!.size).toBe(5)
    expect(await fs.read('notes.md')).toBe('grown')
  })

  it('fails reads when permission is lost, and succeeds again after requestPermission', async () => {
    const { disk, handle, fs } = make()
    disk.access = 'prompt'
    await expect(fs.read('notes.md')).rejects.toThrow()
    expect(await handle.queryPermission()).toBe('prompt')
    expect(await handle.requestPermission()).toBe('granted')
    expect(await fs.read('notes.md')).toBe('hello')
  })
})
