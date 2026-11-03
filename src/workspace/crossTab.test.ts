import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FS_BLOB, openDB } from './db'
import { IdbBackend } from './fallback-idb'
import type * as ManagerModule from './manager'

/**
 * Loads a fresh copy of the manager module. Each copy has its own BroadcastChannel and
 * listeners, the same way two browser tabs would. They share one IndexedDB database.
 */
async function openTab(): Promise<typeof ManagerModule> {
  vi.resetModules()
  return (await import('./manager')) as typeof ManagerModule
}

describe('cross-tab changes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tells other tabs which workspace a write changed', async () => {
    const db = await openDB('cross-write', new IDBFactory())
    const writer = await openTab()
    const reader = await openTab()
    const mw = new writer.WorkspaceManager(db, new IdbBackend(db))
    const mr = new reader.WorkspaceManager(db, new IdbBackend(db))
    const seen: unknown[] = []
    mr.onRemoteChange((c) => seen.push(c))

    const meta = await mw.create('Project')
    await mw.fs(meta.id).write('a.txt', 'hi')

    await vi.waitFor(() => expect(seen).toContainEqual({ ws: meta.id }))
  })

  it('tells other tabs when the workspace list changes', async () => {
    const db = await openDB('cross-list', new IDBFactory())
    const writer = await openTab()
    const reader = await openTab()
    const mw = new writer.WorkspaceManager(db, new IdbBackend(db))
    const mr = new reader.WorkspaceManager(db, new IdbBackend(db))
    const seen: unknown[] = []
    mr.onRemoteChange((c) => seen.push(c))

    await mw.create('Project')

    await vi.waitFor(() => expect(seen).toContainEqual({ ws: null }))
  })

  it('lists a tree without reading any file bytes', async () => {
    const db = await openDB('listing', new IDBFactory())
    const fs = new IdbBackend(db).open('w')
    await fs.write('src/a.ts', 'export const a = 1\n')
    await fs.writeBytes('img.bin', new Uint8Array(4096))

    // Any cursor over the bytes store during a listing is a bug: it would load every file.
    const realCursor = IDBObjectStore.prototype.openCursor
    vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof realCursor>
    ) {
      if (this.name === FS_BLOB) throw new Error('listing read file bytes')
      return realCursor.apply(this, args)
    })

    const all = await fs.listAll()
    const top = await fs.list('')

    // Depth-first: directories first, then their children, then the sibling file.
    expect(all).toEqual([
      { name: 'src', path: 'src', kind: 'dir' },
      { name: 'a.ts', path: 'src/a.ts', kind: 'file', size: 19 },
      { name: 'img.bin', path: 'img.bin', kind: 'file', size: 4096 },
    ])
    expect(top.map((e) => e.path)).toEqual(['src', 'img.bin'])
  })
})
