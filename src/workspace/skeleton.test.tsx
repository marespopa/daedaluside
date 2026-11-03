import { render, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  openBuffersAtom,
  sidebarOpenAtom,
  snapshotAtom,
  treeAtom,
  workspacesAtom,
  workspaceStatusAtom,
  type SessionSnapshot,
} from '../state/workspaceAtoms'
import {
  startSnapshotSync,
  readSnapshot,
  SNAPSHOT_KEY,
  writeSnapshot,
  buildSnapshot,
} from './snapshot'

const SAVED: SessionSnapshot = {
  workspaceId: 'old-id',
  name: 'Proj',
  tree: [
    { path: 'docs', kind: 'dir' },
    { path: 'docs/notes.md', kind: 'file' },
    { path: 'main.ts', kind: 'file' },
  ],
  openFiles: ['main.ts', 'docs/notes.md'],
  activeFile: 'main.ts',
}

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('session snapshot', () => {
  it('reads nothing when there is no saved session', () => {
    expect(readSnapshot(memoryStorage())).toBeNull()
  })

  it('treats malformed or wrongly shaped data as no snapshot', () => {
    const s = memoryStorage()
    s.setItem(SNAPSHOT_KEY, '{not json')
    expect(readSnapshot(s)).toBeNull()
    s.setItem(SNAPSHOT_KEY, JSON.stringify({ workspaceId: 'x', tree: 'nope' }))
    expect(readSnapshot(s)).toBeNull()
    s.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ ...SAVED, tree: [{ path: 1, kind: 'file' }] }),
    )
    expect(readSnapshot(s)).toBeNull()
  })

  it('round-trips a valid snapshot', () => {
    const s = memoryStorage()
    writeSnapshot(SAVED, s)
    expect(readSnapshot(s)).toEqual(SAVED)
  })

  it('is only built once the workspace is ready', () => {
    const store = createStore()
    store.set(currentWorkspaceIdAtom, 'w1')
    store.set(workspacesAtom, [{ id: 'w1', name: 'Proj' } as never])
    expect(buildSnapshot(store)).toBeNull()
    store.set(workspaceStatusAtom, { state: 'ready', backend: 'idb' })
    expect(buildSnapshot(store)).toMatchObject({ workspaceId: 'w1', name: 'Proj' })
  })

  it('saves to localStorage when the live state changes after ready', () => {
    localStorage.clear()
    const store = createStore()
    startSnapshotSync(store)
    store.set(currentWorkspaceIdAtom, 'w1')
    store.set(workspacesAtom, [{ id: 'w1', name: 'Proj' } as never])
    store.set(treeAtom, [{ path: 'a.ts', kind: 'file' } as never])
    store.set(openBuffersAtom, [
      { path: 'a.ts', pinned: false, dirty: false, saveError: false },
    ])
    store.set(activePathAtom, 'a.ts')
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull() // still loading
    store.set(workspaceStatusAtom, { state: 'ready', backend: 'idb' })
    expect(readSnapshot()).toMatchObject({ workspaceId: 'w1', openFiles: ['a.ts'] })
    localStorage.clear()
  })
})

describe('loading skeleton', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    writeSnapshot(SAVED)
  })

  it('shows the last session while storage starts, then the live workspace', async () => {
    const store = createStore()
    store.set(sidebarOpenAtom, true)
    render(
      <Provider store={store}>
        <App />
      </Provider>,
    )

    // First paint, before storage has started.
    expect(screen.getByTestId('editor-skeleton')).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Open files' })
    expect(within(tabs).getByText('main.ts')).toBeInTheDocument()
    expect(within(tabs).queryByRole('button')).toBeNull()
    const tree = screen.getByRole('complementary', { name: 'File tree' })
    expect(tree).toHaveAttribute('aria-busy', 'true')
    expect(within(tree).getByText('notes.md')).toBeInTheDocument()

    // Storage is ready: the skeleton is replaced by the real workspace.
    await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
    await waitFor(() => expect(screen.queryByTestId('editor-skeleton')).toBeNull())
    expect(tree).toHaveAttribute('aria-busy', 'false')
  })

  it('shows no skeleton when there is no saved session', async () => {
    localStorage.clear()
    const store = createStore()
    render(
      <Provider store={store}>
        <App />
      </Provider>,
    )
    expect(screen.queryByTestId('editor-skeleton')).toBeNull()
    expect(store.get(snapshotAtom)).toBeNull()
    await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  })
})
