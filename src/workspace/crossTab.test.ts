import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDB } from './db'
import { OpfsBackend } from './opfs'
import { getMemoryOpfs } from './testing/opfsSetup'
import type * as ManagerModule from './manager'

/**
 * Loads a fresh copy of the manager module. Each copy has its own BroadcastChannel and
 * listeners, the same way two browser tabs would. They share one IndexedDB database and
 * one OPFS root.
 */
async function openTab(): Promise<typeof ManagerModule> {
  vi.resetModules()
  return (await import('./manager')) as typeof ManagerModule
}

function makeBackend(db: IDBDatabase) {
  return new OpfsBackend(getMemoryOpfs().rootHandle(), db)
}

describe('cross-tab changes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tells other tabs which workspace a write changed', async () => {
    const db = await openDB('cross-write', new IDBFactory())
    const writer = await openTab()
    const reader = await openTab()
    const mw = new writer.WorkspaceManager(db, makeBackend(db))
    const mr = new reader.WorkspaceManager(db, makeBackend(db))
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
    const mw = new writer.WorkspaceManager(db, makeBackend(db))
    const mr = new reader.WorkspaceManager(db, makeBackend(db))
    const seen: unknown[] = []
    mr.onRemoteChange((c) => seen.push(c))

    await mw.create('Project')

    await vi.waitFor(() => expect(seen).toContainEqual({ ws: null }))
  })
})
