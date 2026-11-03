import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { idbDelete, idbPut, openDB } from './db'
import { OpfsBackend } from './opfs'
import { runFSContract } from './fsContract'
import { FSError } from './types'
import { createMemoryOpfs } from './testing/memoryOpfs'

runFSContract('OPFS (native move)', async () => {
  const db = await openDB('opfs-move', new IDBFactory())
  const opfs = createMemoryOpfs({ moveEnabled: true })
  return new OpfsBackend(opfs.rootHandle(), db)
})

runFSContract('OPFS (rename fallback)', async () => {
  const db = await openDB('opfs-fallback', new IDBFactory())
  const opfs = createMemoryOpfs({ moveEnabled: false })
  return new OpfsBackend(opfs.rootHandle(), db)
})

describe('OPFS focused tests', () => {
  async function makeBackend(name: string, moveEnabled = true) {
    const db = await openDB(name, new IDBFactory())
    const opfs = createMemoryOpfs({ moveEnabled })
    return { backend: new OpfsBackend(opfs.rootHandle(), db), opfs }
  }

  it('keeps old content when a write fails before close', async () => {
    const { backend, opfs } = await makeBackend('opfs-atomic')
    const fs = backend.open('ws1')
    await fs.write('f.txt', 'old content')
    await opfs.breakFile('workspaces/ws1/f.txt')
    await expect(fs.write('f.txt', 'new content')).rejects.toThrow()
    expect(await fs.read('f.txt')).toBe('old content')
  })

  it('overwrites with shorter content without leaving stale tail bytes', async () => {
    const { backend } = await makeBackend('opfs-truncate')
    const fs = backend.open('ws1')
    await fs.write('f.txt', 'long content here')
    await fs.write('f.txt', 'short')
    expect(await fs.read('f.txt')).toBe('short')
    await fs.write('f.txt', '')
    expect(await fs.read('f.txt')).toBe('')
    expect((await fs.stat('f.txt'))!.size).toBe(0)
  })

  it('refuses mutating operations once the workspace record is deleted', async () => {
    const db = await openDB('opfs-live', new IDBFactory())
    const opfs = createMemoryOpfs()
    const backend = new OpfsBackend(opfs.rootHandle(), db)
    await idbPut(db, 'workspaces', 'ws1', {
      id: 'ws1',
      name: 'Live',
      created: 0,
      updated: 0,
      openFiles: [],
      activeFile: null,
    })
    const fs = backend.open('ws1', { requireWorkspace: true })
    await fs.write('f.txt', 'ok')
    await idbDelete(db, 'workspaces', 'ws1')
    await expect(fs.write('f.txt', 'x')).rejects.toSatisfy(
      (e) => e instanceof FSError && e.code === 'ENOENT',
    )
  })
})
