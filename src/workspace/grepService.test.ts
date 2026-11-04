import { describe, expect, it, vi } from 'vitest'
import { GrepService, createBackend, type GrepStatus } from './grepService'
import { readForIndex } from './grepRead'
import type { Entry, WorkspaceFS } from './types'
import { MemDisk } from './testing/memoryDisk'

const enc = (s: string) => new TextEncoder().encode(s)
const file = (path: string, size: number, mtime?: number): Entry => ({
  name: path.split('/').pop()!,
  path,
  kind: 'file',
  size,
  ...(mtime === undefined ? {} : { mtime }),
})

function setup() {
  const disk = new MemDisk()
  disk.setFile('a.txt', enc('hello world\n'))
  disk.setFile('src/b.txt', enc('needle here\n'))
  disk.setFile('bin.dat', new Uint8Array([1, 0, 2]))
  const root = disk.handle() as unknown as FileSystemDirectoryHandle
  return { disk, root }
}

/** A file system whose reads must not happen when the backend reads for itself. */
const forbiddenFs = {
  readBytes: vi.fn(async () => {
    throw new Error('main thread must not read')
  }),
} as unknown as WorkspaceFS

const settle = () => new Promise<void>((r) => setTimeout(r, 20))

function search(svc: GrepService, q: string) {
  return new Promise<string[]>((resolve) => {
    const paths: string[] = []
    svc.search(
      q,
      [],
      (h) => paths.push(...h.map((x) => x.path)),
      () => resolve(paths),
    )
  })
}

describe('readForIndex', () => {
  it('decodes text and skips binary, empty and missing files', async () => {
    const { disk, root } = setup()
    disk.setFile('empty.txt', new Uint8Array())
    expect((await readForIndex(root, 'src/b.txt')).text).toBe('needle here\n')
    expect(await readForIndex(root, 'bin.dat')).toMatchObject({ size: 3, text: null })
    expect(await readForIndex(root, 'empty.txt')).toMatchObject({ size: 0, text: null })
    expect((await readForIndex(root, 'nope.txt')).size).toBe(-1)
  })
})

describe('GrepService with a folder handle', () => {
  it('indexes through the handle without reading on the main thread', async () => {
    const { root } = setup()
    const status: GrepStatus[] = []
    const svc = new GrepService(forbiddenFs, (s) => status.push(s), createBackend(root), root)
    svc.sync([file('a.txt', 12), file('src/b.txt', 12), file('bin.dat', 3)])
    await settle()
    expect(forbiddenFs.readBytes).not.toHaveBeenCalled()
    expect(await search(svc, 'needle')).toEqual(['src/b.txt'])
    expect(status.at(-1)).toMatchObject({ indexed: 3, total: 3 })
    svc.dispose()
  })

  it('re-reads a file whose mtime changed at the same size', async () => {
    const { disk, root } = setup()
    const svc = new GrepService(forbiddenFs, () => {}, createBackend(root), root)
    svc.sync([file('a.txt', 12, 1)])
    await settle()
    expect(await search(svc, 'hello')).toEqual(['a.txt'])
    disk.setFile('a.txt', enc('HELLO_new!\n\n')) // 12 bytes again
    svc.sync([file('a.txt', 12, 1)]) // same size and mtime: not re-read
    await settle()
    expect(await search(svc, 'HELLO_new')).toEqual([])
    svc.sync([file('a.txt', 12, 2)]) // mtime moved: re-read
    await settle()
    expect(await search(svc, 'HELLO_new')).toEqual(['a.txt'])
    svc.dispose()
  })

  it('falls back to reading through fs when there is no folder handle', async () => {
    const fs = {
      readBytes: vi.fn(async () => enc('plain text\n')),
    } as unknown as WorkspaceFS
    const svc = new GrepService(fs, () => {}, createBackend())
    svc.sync([file('x.txt', 11)])
    await settle()
    expect(fs.readBytes).toHaveBeenCalledWith('x.txt')
    expect(await search(svc, 'plain')).toEqual(['x.txt'])
    svc.dispose()
  })
})
