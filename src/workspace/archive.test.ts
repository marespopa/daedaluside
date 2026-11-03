import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { zipSync } from 'fflate'
import {
  entriesFromFileList,
  exportZip,
  importEntries,
  readZip,
  walkTree,
} from './archive'
import { openDB } from './db'
import { IdbBackend } from './fallback-idb'
import { WorkspaceManager } from './manager'
import { OpfsBackend } from './opfs-fs'
import { memoryRoot } from './testing/memoryOpfs'
import type { FSBackend } from './types'

const backends: [string, () => Promise<FSBackend>][] = [
  ['OPFS', async () => new OpfsBackend(async () => memoryRoot())],
  ['IDB', async () => new IdbBackend(await openDB('a', new IDBFactory()))],
]

describe.each(backends)('zip import/export (%s)', (_name, make) => {
  it('import after export reproduces the same file tree', async () => {
    const backend = await make()
    const a = backend.open('a')
    await a.write('README.md', '# hi')
    await a.write('src/deep/er/main.ts', 'export {}')
    await a.write('src/util.ts', 'x')
    await a.writeBytes('assets/logo.bin', new Uint8Array([0, 1, 2, 255, 254]))
    await a.mkdir('empty/nested')

    const zip = await exportZip(a)
    const b = backend.open('b')
    await importEntries(b, readZip(zip))

    const tree = async (fs: typeof a) =>
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

describe('WorkspaceManager', () => {
  it('creates, renames, saves sessions and deletes with files', async () => {
    const db = await openDB('m', new IDBFactory())
    const backend = new IdbBackend(db)
    const m = new WorkspaceManager(db, backend)
    const ws = await m.create('  Alpha ')
    expect(ws.name).toBe('Alpha')
    await m.fs(ws.id).write('x/y.txt', 'data')
    await m.rename(ws.id, 'Beta')
    await m.saveSession(ws.id, ['x/y.txt'], 'x/y.txt')
    expect(await m.get(ws.id)).toMatchObject({
      name: 'Beta',
      openFiles: ['x/y.txt'],
      activeFile: 'x/y.txt',
    })
    await m.setLastId(ws.id)
    expect(await m.getLastId()).toBe(ws.id)
    await expect(m.create('   ')).rejects.toThrow()
    await m.remove(ws.id)
    expect(await m.list()).toEqual([])
    expect(await m.fs(ws.id).list('')).toEqual([])
  })
})
