import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceController } from './controller'
import { openDB } from './db'
import { IdbBackend } from './fallback-idb'
import type { WorkspaceFS } from './types'

/**
 * Two tabs: each one is a fresh copy of the controller and its modules, with its own
 * store and BroadcastChannel. Both use the same IndexedDB database.
 */
async function openTab() {
  vi.resetModules()
  const { createStore } = await import('jotai')
  const { WorkspaceController: Controller } = await import('./controller')
  const atoms = await import('../state/workspaceAtoms')
  const store = createStore()
  const controller = new Controller(store)
  await controller.init()
  return { controller, store, atoms }
}

/** Private state of a controller, for asserting on buffers and writing from the other tab. */
type Internals = {
  fs: WorkspaceFS
  buffers: Map<string, { dirty: boolean; saved: { toString(): string }; state: { doc: { toString(): string } } }>
}
const inside = (c: WorkspaceController) => c as unknown as Internals

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('two tabs on one workspace', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('shows a file created in one tab in the other tab tree', async () => {
    const a = await openTab()
    const b = await openTab()

    await a.controller.createFile('from-a.ts')

    await vi.waitFor(() =>
      expect(b.store.get(b.atoms.treeAtom).map((e) => e.path)).toContain('from-a.ts'),
    )
  })

  it('reloads a clean open file when the other tab saves it', async () => {
    const a = await openTab()
    const b = await openTab()
    await a.controller.createFile('notes.md')
    await a.controller.openFile('notes.md')
    await b.controller.openFile('notes.md')

    await inside(a.controller).fs.write('notes.md', 'written in tab A\n')

    await vi.waitFor(() =>
      expect(inside(b.controller).buffers.get('notes.md')?.state.doc.toString()).toBe(
        'written in tab A\n',
      ),
    )
    expect(inside(b.controller).buffers.get('notes.md')?.dirty).toBe(false)
  })

  it('keeps unsaved edits in the other tab and says the file changed', async () => {
    const a = await openTab()
    const b = await openTab()
    await a.controller.createFile('draft.md')
    await a.controller.openFile('draft.md')
    await b.controller.openFile('draft.md')
    // Tab B has an edit it has not saved yet.
    const mine = inside(b.controller).buffers.get('draft.md')!
    mine.state = { doc: { toString: () => 'my unsaved text' } } as never
    mine.dirty = true

    await inside(a.controller).fs.write('draft.md', 'from tab A\n')

    await vi.waitFor(() =>
      expect(b.store.get(b.atoms.noticeAtom)?.text).toContain('changed in another tab'),
    )
    await sleep(0)
    expect(inside(b.controller).buffers.get('draft.md')?.state.doc.toString()).toBe(
      'my unsaved text',
    )
  })

  it('a workspace deleted in the other tab is not written back by this tab', async () => {
    const a = await openTab()
    const b = await openTab()
    await a.controller.createFile('draft.md')
    await a.controller.openFile('draft.md')
    await b.controller.openFile('draft.md')
    const deletedId = a.store.get(a.atoms.currentWorkspaceIdAtom)!
    // Tab B has unsaved edits in a file of the workspace tab A is about to delete.
    const mine = inside(b.controller).buffers.get('draft.md')!
    mine.state = { doc: { toString: () => 'unsaved in B' } } as never
    mine.dirty = true

    await a.controller.deleteWorkspace(deletedId)

    await vi.waitFor(() =>
      expect(b.store.get(b.atoms.currentWorkspaceIdAtom)).not.toBe(deletedId),
    )
    // Tab B tries to save its stale buffer. Nothing may come back under the deleted id.
    await b.controller.flushAll()
    const storage = new IdbBackend(await openDB()).open(deletedId)
    expect(await storage.listAll()).toEqual([])
    expect(b.store.get(b.atoms.openBuffersAtom)).toEqual([])
    expect(b.store.get(b.atoms.noticeAtom)?.text).toContain('deleted in another tab')
  })
})
