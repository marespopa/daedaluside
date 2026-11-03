import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FS_BLOB, FS_META, linkKey, openDB, SETTINGS, WORKSPACES } from './db'
import { IdbBackend } from './fallback-idb'
import { WorkspaceManager } from './manager'

describe('IndexedDB workspace nodes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses writes once the workspace record is gone, and leaves no files behind', async () => {
    const db = await openDB('guard', new IDBFactory())
    const backend = new IdbBackend(db)
    const manager = new WorkspaceManager(db, backend)
    const meta = await manager.create('Project')
    const live = backend.open(meta.id, { requireWorkspace: true })
    await live.write('a.txt', 'one')

    await manager.remove(meta.id)

    await expect(live.write('a.txt', 'two')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(live.writeBytes('b.bin', new Uint8Array(1))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(live.mkdir('dir')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await backend.open(meta.id).listAll()).toEqual([])
  })

  it('unguarded handles keep working, as before', async () => {
    const db = await openDB('unguarded', new IDBFactory())
    const fs = new IdbBackend(db).open('no-record')
    await fs.write('a.txt', 'x')
    expect(await fs.read('a.txt')).toBe('x')
  })

  it('renames a folder by changing one record and never touches file bytes', async () => {
    const db = await openDB('rename', new IDBFactory())
    const fs = new IdbBackend(db).open('w')
    await fs.write('src/a.ts', 'A')
    await fs.write('src/deep/b.ts', 'B')
    await fs.mkdir('src/empty')

    const touched: string[] = []
    const realPut = IDBObjectStore.prototype.put
    const realDelete = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof realPut>
    ) {
      touched.push(`put:${this.name}`)
      return realPut.apply(this, args)
    })
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof realDelete>
    ) {
      touched.push(`delete:${this.name}`)
      return realDelete.apply(this, args)
    })

    await fs.rename('src', 'lib')
    vi.restoreAllMocks()

    expect(touched).toEqual([`put:${FS_META}`])
    expect(await fs.read('lib/deep/b.ts')).toBe('B')
    expect(await fs.read('lib/a.ts')).toBe('A')
    expect(await fs.stat('lib/empty')).toMatchObject({ kind: 'dir' })
    expect(await fs.stat('src')).toBeNull()
    expect(touched.some((t) => t.includes(FS_BLOB))).toBe(false)
  })

  it('destroying a workspace removes its record and its linked-folder record too', async () => {
    const db = await openDB('destroy', new IDBFactory())
    const backend = new IdbBackend(db)
    const manager = new WorkspaceManager(db, backend)
    const meta = await manager.create('Project')
    await backend.open(meta.id).write('a.txt', 'x')
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS, 'readwrite')
      tx.objectStore(SETTINGS).put({}, linkKey(meta.id))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    await manager.remove(meta.id)

    const count = (store: string) =>
      new Promise<number>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    expect(await count(WORKSPACES)).toBe(0)
    expect(await count(FS_META)).toBe(0)
    expect(await count(FS_BLOB)).toBe(0)
    expect(await count(SETTINGS)).toBe(0)
  })

  it('upgrading from version 2 clears the old path-keyed records', async () => {
    const factory = new IDBFactory()
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('upgrade', 2)
      req.onupgradeneeded = () => {
        for (const s of ['settings', 'vault', WORKSPACES, 'runs', 'snapshots', FS_META, FS_BLOB])
          req.result.createObjectStore(s)
        req.result.createObjectStore('fs-fallback')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = old.transaction([WORKSPACES, FS_META], 'readwrite')
      tx.objectStore(WORKSPACES).put({ id: 'old' }, 'old')
      tx.objectStore(FS_META).put({ kind: 'dir', mtime: 0 }, 'old:src')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    old.close()

    const db = await openDB('upgrade', factory)

    const count = (store: string) =>
      new Promise<number>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    expect(db.version).toBe(3)
    expect(await count(WORKSPACES)).toBe(0)
    expect(await count(FS_META)).toBe(0)
    expect(db.transaction(FS_META).objectStore(FS_META).indexNames.contains('byParent')).toBe(
      true,
    )
  })
})
