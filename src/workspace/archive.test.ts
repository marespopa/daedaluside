import 'fake-indexeddb/auto'
import { zipSync } from 'fflate'
import {
  entriesFromFileList,
  exportZip,
  importEntries,
  readZip,
  unwrapTopFolder,
  walkTree,
  type ImportEntry,
} from './archive'
import { FolderFS } from './folderFs'
import { MemDisk } from './testing/memoryDisk'
import type { WorkspaceFS } from './types'

const makeFolderFS = (disk = new MemDisk()) => new FolderFS(disk.handle() as never)

describe('zip import/export (folder)', () => {
  it('import after export reproduces the same file tree', async () => {
    const a = makeFolderFS()
    await a.write('README.md', '# hi')
    await a.write('src/deep/er/main.ts', 'export {}')
    await a.write('src/util.ts', 'x')
    await a.writeBytes('assets/logo.bin', new Uint8Array([0, 1, 2, 255, 254]))
    await a.mkdir('empty/nested')

    const zip = await exportZip(a)
    const b = makeFolderFS()
    await importEntries(b, readZip(zip))

    const tree = async (fs: WorkspaceFS) =>
      Promise.all(
        (await walkTree(fs)).map(async (e) => ({
          path: e.path,
          kind: e.kind,
          content: e.kind === 'file' ? Array.from(await fs.readBytes(e.path)) : null,
        })),
      )
    const original = await tree(a)
    expect(original.map((e) => e.path)).toContain('empty/nested')
    expect(await tree(b)).toEqual(original)
    // And a second round trip is stable.
    expect(await exportZip(b)).toBeInstanceOf(Uint8Array)
    expect(await tree(b)).toEqual(original)
  })
})

describe('readZip safety', () => {
  const enc = (s: string) => new TextEncoder().encode(s)

  it('rejects path traversal', () => {
    expect(() => readZip(zipSync({ '../evil.txt': enc('x') }))).toThrow()
  })

  it('skips __MACOSX, .git and node_modules', () => {
    const zip = zipSync({
      'ok.txt': enc('1'),
      '__MACOSX/._ok.txt': enc('x'),
      'p/node_modules/a/index.js': enc('x'),
      '.git/HEAD': enc('x'),
    })
    expect(readZip(zip).map((e) => e.path)).toEqual(['ok.txt'])
  })

  it('rejects garbage input', () => {
    expect(() => readZip(enc('not a zip'))).toThrow()
  })
})

describe('entriesFromFileList', () => {
  it('strips the picked folder name and skips ignored dirs', () => {
    const f = (rel: string) => {
      const file = new File(['x'], rel.split('/').pop()!)
      Object.defineProperty(file, 'webkitRelativePath', { value: rel })
      return file
    }
    const { name, entries } = entriesFromFileList([
      f('proj/a.txt'),
      f('proj/src/b.ts'),
      f('proj/node_modules/x/y.js'),
    ])
    expect(name).toBe('proj')
    expect(entries.map((e) => e.path)).toEqual(['a.txt', 'src/b.ts'])
  })
})

describe('import progress', () => {
  it('reports every 25 entries and always the final count', async () => {
    const fs = makeFolderFS()
    const entries = Array.from({ length: 60 }, (_, i) => ({
      kind: 'file' as const,
      path: `f${i}.txt`,
      read: async () => new TextEncoder().encode(String(i)),
    }))
    const seen: [number, number][] = []
    const result = await importEntries(fs, entries, (done, total) => {
      seen.push([done, total])
    })
    expect(result).toEqual({ files: 60, dirs: 0 })
    expect(seen).toEqual([
      [25, 60],
      [50, 60],
      [60, 60],
    ])
  })
})

describe('unwrapTopFolder', () => {
  const file = (path: string): ImportEntry => ({
    kind: 'file',
    path,
    read: async () => new Uint8Array(),
  })
  const dir = (path: string): ImportEntry => ({ kind: 'dir', path })

  it('makes the wrapper folder the root when the archive is named after it', () => {
    const out = unwrapTopFolder(
      [dir('proj'), dir('proj/src'), file('proj/src/a.ts'), file('proj/README.md')],
      'proj',
    )
    expect(out.map((e) => e.path)).toEqual(['src', 'src/a.ts', 'README.md'])
  })

  it('works when the folder entry itself is missing from the archive', () => {
    const out = unwrapTopFolder([file('proj/a.ts')], 'Proj')
    expect(out.map((e) => e.path)).toEqual(['a.ts'])
  })

  it('leaves other archives alone', () => {
    const named = [dir('proj'), file('proj/a.ts')]
    expect(unwrapTopFolder(named, 'other')).toEqual(named)
    const mixed = [dir('proj'), file('proj/a.ts'), file('notes.md')]
    expect(unwrapTopFolder(mixed, 'proj')).toEqual(mixed)
    const bare = [file('proj')]
    expect(unwrapTopFolder(bare, 'proj')).toEqual(bare)
  })
})
