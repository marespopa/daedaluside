import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import { vi } from 'vitest'
import App from '../App'
import { editorHandleAtom, paletteOpenAtom } from '../state/editorAtoms'
import { branchTabActiveAtom } from '../state/branchReviewAtoms'
import { reviewOpenAtom } from '../state/gitAtoms'
import { runEx } from '../editor/testing/runEx'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  linkedFolderAtom,
  noticeAtom,
  openBuffersAtom,
  sidebarOpenAtom,
  treeAtom,
  treeProgressAtom,
  treeStatusAtom,
  workspacesAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { AUTOSAVE_MS, getController } from './controller'
import { fileLinkKey, idbGet, linkKey, openDB } from './db'
import { WorkspaceManager } from './manager'
import { MemDisk } from './testing/memoryDisk'
import type { WorkspaceFS } from './types'

/** The store of the most recent `mount()`, for helpers that take no arguments. */
let lastStore: ReturnType<typeof createStore> | null = null
let lastDisk: MemDisk | null = null

function mount() {
  const store = createStore()
  lastStore = store
  const view = render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  return { store, ...view }
}

const type = (store: ReturnType<typeof createStore>, text: string) => {
  const v = store.get(editorHandleAtom)!.view
  act(() => v.dispatch({ changes: { from: v.state.doc.length, insert: text } }))
}

const fsOf = (store: ReturnType<typeof createStore>) =>
  (getController(store) as unknown as { fs: WorkspaceFS }).fs

const tab = (name: string) => screen.findByRole('tab', { name: new RegExp(`^${name}`) })

/** The tree's entry paths, in the flat depth-first order the controller keeps. */
const treePaths = (store: ReturnType<typeof createStore>) =>
  store.get(treeAtom).map((e) => e.path)

async function openFolder(
  store: ReturnType<typeof createStore>,
  disk: MemDisk,
  firstFile?: string,
) {
  lastDisk = disk
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  const handle = disk.handle()
  await act(async () => {
    await getController(store).importFolderHandle(handle as never)
  })
  if (firstFile) {
    await waitFor(() => expect(store.get(activePathAtom)).toBe(firstFile))
  }
}

async function scratchTab() {
  const store = lastStore!
  const disk = lastDisk ?? new MemDisk()
  if (!lastDisk) await openFolder(store, disk)
  if (!store.get(treeAtom).some((e) => e.path === 'scratch.ts')) {
    await act(async () => {
      await getController(store).createFile('scratch.ts')
    })
  }
  return tab('scratch.ts')
}

async function savedSession(store: ReturnType<typeof createStore>) {
  const db = await openDB()
  return new WorkspaceManager(db).get(store.get(currentWorkspaceIdAtom)!)
}

async function onDisk(store: ReturnType<typeof createStore>, path: string) {
  return fsOf(store).read(path)
}

describe('workspace in the app', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  it('creates a scratch file, saves with Mod-S, and restores after a reload', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    type(a.store, 'hello')
    expect(await screen.findByLabelText('unsaved')).toBeInTheDocument()
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() =>
      expect(screen.queryByLabelText('unsaved')).not.toBeInTheDocument(),
    )
    expect(await onDisk(a.store, 'scratch.ts')).toBe('hello')
    getController(a.store).flushOnHide()
    await waitFor(async () =>
      expect((await savedSession(a.store))?.openFiles).toEqual(['scratch.ts']),
    )
    a.unmount()

    const b = mount()
    await openFolder(b.store, disk)
    await scratchTab()
    await waitFor(() =>
      expect(b.store.get(editorHandleAtom)!.view.state.doc.toString()).toBe('hello'),
    )
  })

  it('autosaves after a pause', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    type(a.store, 'auto')
    await waitFor(async () => expect(await onDisk(a.store, 'scratch.ts')).toBe('auto'), {
      timeout: 3000,
    })
  })

  it('discarding a tab drops its unsaved edits and never writes them', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    type(a.store, 'draft')
    await act(() => getController(a.store).discardBuffer('scratch.ts'))
    await new Promise((r) => setTimeout(r, AUTOSAVE_MS + 200))
    expect(await onDisk(a.store, 'scratch.ts')).toBe('')
    expect(screen.queryByRole('tab', { name: /^scratch\.ts/ })).toBeNull()
  })

  it('Ctrl-W W switches focus between the tree and editor without closing the tree', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    const view = a.store.get(editorHandleAtom)!.view
    act(() => view.focus())

    await user.keyboard('{Control>}w{/Control}w')
    const tree = screen.getByRole('complementary', { name: 'File tree' })
    expect(tree).toHaveAttribute('aria-hidden', 'false')
    expect((document.activeElement as HTMLElement).dataset.rowKey).toBe('scratch.ts')

    await user.keyboard('{Control>}w{/Control}w')
    expect(view.contentDOM).toHaveFocus()
    expect(tree).toHaveAttribute('aria-hidden', 'false')
  })

  it('creates, renames and deletes nested files from the tree', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    act(() => runEx(a.store.get(editorHandleAtom)!.view, 'Explore'))
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    fireEvent.contextMenu(tree)
    await user.click(await screen.findByRole('menuitem', { name: 'New file' }))
    await user.type(
      within(tree).getByLabelText('New file name'),
      'src/deep/main.ts{Enter}',
    )
    await tab('main.ts')
    expect(a.store.get(activePathAtom)).toBe('src/deep/main.ts')
    expect(await within(tree).findByRole('button', { name: 'deep' })).toBeInTheDocument()

    within(tree).getByRole('button', { name: 'main.ts' }).focus()
    await user.keyboard('{F2}')
    await user.type(
      within(tree).getByLabelText('Rename main.ts'),
      '{Control>}a{/Control}app.ts{Enter}',
    )
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('src/deep/app.ts'))
    expect(await onDisk(a.store, 'src/deep/app.ts')).toBe('')

    const appButton = await within(tree).findByRole('button', { name: 'app.ts' })
    const appRow = appButton.closest<HTMLElement>('li[role="treeitem"]')!
    appButton.focus()
    await user.keyboard('d')
    await user.click(within(appRow).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^app\.ts/ })).toBeNull(),
    )
    expect(a.store.get(activePathAtom)).toBe('scratch.ts')
  })

  it('home goes to the blank page and keeps the open tabs', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    const t = await scratchTab()
    expect(a.store.get(activePathAtom)).toBe('scratch.ts')

    await user.click(screen.getByRole('button', { name: 'Home' }))

    expect(
      await screen.findByRole('region', { name: 'Workspace opener' }),
    ).toBeInTheDocument()
    expect(a.store.get(activePathAtom)).toBeNull()
    expect(t).toBeInTheDocument()
    await user.click(t)
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('scratch.ts'))
  })

  it('opens settings and closes them with Escape', async () => {
    const user = userEvent.setup()
    mount()
    await waitFor(() =>
      expect(screen.queryAllByText(/Open folder/).length).toBeGreaterThan(0),
    )
    await user.keyboard('{Control>},{/Control}')
    const dlg = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(dlg).getByText('Typography')).toBeInTheDocument()
    expect(within(dlg).queryByText(/Keep data when space is low/)).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('workspace opener (editor empty state)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  /** With no folder open, the opener shows and no file is active. */
  async function emptyWorkspace(store: ReturnType<typeof createStore>) {
    await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
    expect(store.get(activePathAtom)).toBeNull()
  }

  const opener = () => screen.findByRole('region', { name: 'Workspace opener' })

  it('replaces the editor with the opener when no file is open', async () => {
    const a = mount()
    await emptyWorkspace(a.store)
    const o = await opener()
    expect(o).toBeInTheDocument()
    for (const label of ['Open folder', 'Open file'])
      expect(within(o).getByText(label)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows an Open folder prompt when no workspace is loaded', async () => {
    const a = mount()
    await emptyWorkspace(a.store)
    const o = await opener()
    expect(within(o).getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
  })

  it('Mod-O lists workspace commands; Workspace: New opens a folder picker', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await emptyWorkspace(a.store)

    vi.stubGlobal('showDirectoryPicker', async () => disk.handle())

    await user.keyboard('{Control>}o{/Control}')
    expect(screen.getByRole('option', { name: 'Workspace: New' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Workspace: New' }))

    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).toBeTruthy())
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
  })

  // Searching from the blank page moved into the command palette; see
  // WorkspaceOpener.test.tsx for it.

  it('a key typed on the blank page starts Untitled-1.md with that text', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))

    fireEvent.keyDown(document.body, { key: 'h' })
    fireEvent.keyDown(document.body, { key: 'i' })

    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('Untitled-1.md'))
    await waitFor(() =>
      expect(a.store.get(editorHandleAtom)!.view.state.doc.toString()).toBe('hi'),
    )
    await waitFor(async () => expect(await onDisk(a.store, 'Untitled-1.md')).toBe('hi'), {
      timeout: 3000,
    })
  })

  it('Mod-N starts Untitled-N.md, numbering past names already in use', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))

    await user.keyboard('{Control>}n{/Control}')
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('Untitled-1.md'))
    await user.keyboard('{Control>}n{/Control}')
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('Untitled-2.md'))
    expect(a.store.get(treeAtom).map((e) => e.name)).toEqual([
      'Untitled-1.md',
      'Untitled-2.md',
    ])
  })
})

describe('re-opening a folder', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  it('switches to the existing workspace instead of adding a duplicate', async () => {
    const disk = new MemDisk()
    disk.setFile('a.ts', new TextEncoder().encode('A'))
    const a = mount()
    await openFolder(a.store, disk, 'a.ts')
    const first = a.store.get(currentWorkspaceIdAtom)

    await act(async () => {
      await getController(a.store).importFolderHandle(disk.handle() as never)
    })

    expect(a.store.get(workspacesAtom)).toHaveLength(1)
    expect(a.store.get(currentWorkspaceIdAtom)).toBe(first)
    expect(await screen.findByText(/is already open/)).toBeInTheDocument()
  })

  it('deletes the current workspace from the palette only after confirmation', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    const doomed = a.store.get(currentWorkspaceIdAtom)!

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.keyboard('{Control>}o{/Control}')
    await user.click(screen.getByRole('option', { name: 'Workspace: Delete Current' }))
    expect(confirm).toHaveBeenCalled()
    expect(a.store.get(workspacesAtom).some((w) => w.id === doomed)).toBe(true)

    confirm.mockReturnValue(true)
    await user.keyboard('{Control>}o{/Control}')
    await user.click(screen.getByRole('option', { name: 'Workspace: Delete Current' }))
    await waitFor(() =>
      expect(a.store.get(workspacesAtom).some((w) => w.id === doomed)).toBe(false),
    )
    expect(a.store.get(currentWorkspaceIdAtom)).toBeNull()
  })
})

describe('read-only linked folder', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  it('lists the files when readwrite lapsed but reading still works', async () => {
    const disk = new MemDisk()
    disk.setFile('a.ts', new TextEncoder().encode('A'))
    disk.access = 'readonly'
    const a = mount()
    await openFolder(a.store, disk)

    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })
    expect(a.store.get(treeAtom).map((e) => e.path)).toEqual(['a.ts'])
    expect(a.store.get(linkedFolderAtom)).toEqual({
      name: 'proj',
      paused: true,
      single: false,
    })
  })

  it('shows the permission state when the folder cannot be read at all', async () => {
    const disk = new MemDisk()
    disk.setFile('a.ts', new TextEncoder().encode('A'))
    disk.access = 'prompt'
    const a = mount()
    await openFolder(a.store, disk)

    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'permission' })
    expect(a.store.get(treeAtom)).toEqual([])
    expect(a.store.get(linkedFolderAtom)).toEqual({
      name: 'proj',
      paused: true,
      single: false,
    })
  })

  it('a dismissed folder picker is not an error and does not import', async () => {
    const user = userEvent.setup()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    const opener = await screen.findByRole('region', { name: 'Workspace opener' })

    vi.stubGlobal(
      'showDirectoryPicker',
      vi.fn(async () => {
        throw new DOMException('The user dismissed the picker', 'AbortError')
      }),
    )
    const importSpy = vi
      .spyOn(getController(a.store), 'importFolderHandle')
      .mockResolvedValue()

    await user.click(within(opener).getByRole('button', { name: 'Open folder' }))
    // Let the rejection land in any handler that missed it before checking silence.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(importSpy).not.toHaveBeenCalled()
    expect(a.store.get(noticeAtom)).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('command palette modes', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  async function withFiles(store: ReturnType<typeof createStore>) {
    const disk = new MemDisk()
    disk.setFile('src/app.ts', new TextEncoder().encode('export {}'))
    disk.setFile('README.md', new TextEncoder().encode('# readme'))
    await openFolder(store, disk, 'README.md')
    return getController(store)
  }

  it('searches files by default, commands after >, and opens the chosen file', async () => {
    const user = userEvent.setup()
    const a = mount()
    await withFiles(a.store)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'app')
    expect(screen.getByRole('option', { name: 'src/app.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Theme:/ })).toBeNull()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('src/app.ts'))

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), '>dark')
    expect(screen.getByRole('option', { name: 'Theme: Deep Slate (dark)' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'src/app.ts' })).toBeNull()
    await user.keyboard('{Escape}')
  })

  it('Mod-Shift-P opens the palette already in command mode', async () => {
    const user = userEvent.setup()
    const a = mount()
    await withFiles(a.store)

    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('>')
    expect(screen.getByRole('option', { name: 'File: Save' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
  })

  it('Mod-P opens the palette in file mode', async () => {
    const user = userEvent.setup()
    const a = mount()
    await withFiles(a.store)

    await user.keyboard('{Control>}p{/Control}')
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('option', { name: 'README.md' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
  })

  it('keeps keyboard focus in the palette when a file loads underneath it', async () => {
    const a = mount()
    const c = await withFiles(a.store)
    await act(async () => {
      await c.openFile('src/app.ts')
    })
    await act(async () => {
      a.store.set(paletteOpenAtom, true)
    })
    const input = await screen.findByRole('combobox')
    await act(async () => {
      await c.openFile('README.md')
    })
    expect(input).toHaveFocus()
  })

  it('opens a file mentioned in markdown, and ignores one that is missing', async () => {
    const a = mount()
    const c = await withFiles(a.store)
    await act(async () => {
      await c.openFile('README.md')
    })
    await act(async () => {
      expect(await c.openReference('src/missing.ts')).toBe(false)
      expect(await c.openReference('src/app.ts')).toBe(true)
    })
    expect(a.store.get(activePathAtom)).toBe('src/app.ts')
  })
})

describe('blank install', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    lastDisk = null
  })

  const opener = () => screen.findByRole('region', { name: 'Workspace opener' })

  it('opens a new install to the opener, with no files', async () => {
    const a = mount()
    expect(await opener()).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    expect(treePaths(a.store)).toEqual([])
  })

  it('showHome drops the review overlays that would cover the opener', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    act(() => {
      a.store.set(reviewOpenAtom, true)
      a.store.set(branchTabActiveAtom, true)
    })
    await act(async () => {
      getController(a.store).showHome()
    })
    expect(a.store.get(reviewOpenAtom)).toBe(false)
    expect(a.store.get(branchTabActiveAtom)).toBe(false)

    // Already home (no active file), with the branch tab focused: still clears it.
    act(() => a.store.set(branchTabActiveAtom, true))
    await act(async () => {
      getController(a.store).showHome()
    })
    expect(a.store.get(branchTabActiveAtom)).toBe(false)
    expect(await opener()).toBeInTheDocument()
  })

  it('opens :Explore from the blank page instead of starting an untitled file', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await act(async () => {
      getController(a.store).showHome()
    })
    expect(await opener()).toBeInTheDocument()

    await user.keyboard(':')
    const prompt = document.querySelector<HTMLInputElement>('.cm-vim-panel input')
    expect(prompt).not.toBeNull()
    expect(prompt).toHaveFocus()
    await user.type(prompt!, 'Explore')
    expect(prompt).toHaveValue('Explore')
    await user.keyboard('{Enter}')

    expect(a.store.get(sidebarOpenAtom)).toBe(true)
    await waitFor(() =>
      expect(screen.getByLabelText('File tree')).toHaveAttribute('aria-hidden', 'false'),
    )
    expect(a.store.get(activePathAtom)).toBeNull()
  })
})

describe('stale unlinked workspaces', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    lastDisk = null
  })

  it('prunes a record without a linked folder on boot, leaving the no-folder state', async () => {
    // The old OPFS model left workspace records with no folder link behind; opening
    // one would show a fake empty workspace.
    const db = await openDB()
    await new WorkspaceManager(db).create('stale')

    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))

    expect(a.store.get(workspacesAtom)).toEqual([])
    expect(a.store.get(currentWorkspaceIdAtom)).toBeNull()
    expect(a.store.get(treeAtom)).toEqual([])
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'no-folder' })

    // The opener asks for a folder; nothing pretends a folder is open and empty.
    const o = await screen.findByRole('region', { name: 'Workspace opener' })
    expect(within(o).getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
    expect(screen.queryByText(/folder is empty|Empty folder/)).not.toBeInTheDocument()

    // The stale record is gone from storage, not just hidden from the list.
    expect(await new WorkspaceManager(await openDB()).list()).toEqual([])
  })

  it('shows the no-folder state in the tree sidebar after pruning', async () => {
    const db = await openDB()
    await new WorkspaceManager(db).create('stale')
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await act(async () => {
      a.store.set(sidebarOpenAtom, true)
    })

    const tree = screen.getByRole('complementary', { name: 'File tree' })
    expect(within(tree).getByText('No folder open')).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
    expect(screen.queryByText(/folder is empty|Empty folder/)).not.toBeInTheDocument()
  })
})

describe('tree context menu', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  it('creates in the right-clicked folder, and at the root from empty space', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    disk.setFile('docs/a.md', new TextEncoder().encode('a'))
    disk.setFile('main.ts', new TextEncoder().encode('m'))
    const a = mount()
    await openFolder(a.store, disk)
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    fireEvent.contextMenu(within(tree).getByRole('button', { name: 'docs' }))
    await user.click(await screen.findByRole('menuitem', { name: 'New file' }))
    await user.type(within(tree).getByLabelText('New file name'), 'b.ts{Enter}')
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('docs/b.ts'))

    fireEvent.contextMenu(tree)
    await user.click(await screen.findByRole('menuitem', { name: 'New folder' }))
    await user.type(within(tree).getByLabelText('New folder name'), 'lib{Enter}')
    await waitFor(() =>
      expect(a.store.get(treeAtom)).toContainEqual(
        expect.objectContaining({ path: 'lib', kind: 'dir' }),
      ),
    )
  })

  it('renames and deletes a folder from its row menu after confirmation', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    disk.setFile('docs/a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk, 'docs/a.md')
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    fireEvent.contextMenu(within(tree).getByRole('button', { name: 'docs' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const rename = within(tree).getByRole('textbox', { name: 'Rename docs' })
    await user.clear(rename)
    await user.type(rename, 'guide{Enter}')
    await waitFor(() =>
      expect(a.store.get(treeAtom).map((entry) => entry.path)).toContain('guide/a.md'),
    )

    fireEvent.contextMenu(within(tree).getByRole('button', { name: 'guide' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(within(tree).getByText('Delete guide?')).toBeInTheDocument()
    await user.click(within(tree).getByRole('button', { name: 'Cancel' }))
    expect(a.store.get(treeAtom).map((entry) => entry.path)).toContain('guide/a.md')

    fireEvent.contextMenu(within(tree).getByRole('button', { name: 'guide' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(within(tree).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(a.store.get(treeAtom).map((entry) => entry.path)).not.toContain(
        'guide/a.md',
      ),
    )
  })
})

describe('quick finder in the tree', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  it('opens the highlighted file from the search box', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    disk.setFile('docs/a.md', new TextEncoder().encode('a'))
    disk.setFile('main.ts', new TextEncoder().encode('m'))
    const a = mount()
    // A new folder opens its shallowest first file, not the alphabetically first path.
    await openFolder(a.store, disk, 'main.ts')
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    await user.type(
      within(tree).getByRole('textbox', { name: 'Find a file' }),
      'a.md{Enter}',
    )
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('docs/a.md'))
  })
})

describe('double Shift', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  it('opens the command palette in command mode', async () => {
    const user = userEvent.setup()
    mount()
    await waitFor(() =>
      expect(screen.queryAllByText(/Open folder/).length).toBeGreaterThan(0),
    )
    await user.keyboard('{Shift}{/Shift}{Shift}{/Shift}')
    expect((await screen.findByRole('combobox')) as HTMLInputElement).toHaveValue('>')
    await user.keyboard('{Escape}')
  })
})

describe('incremental tree updates', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    lastDisk = null
  })

  it('create, untitled, rename and delete patch the tree without a walk', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk)
    const listAll = vi.spyOn(fsOf(a.store)!, 'listAll')
    const c = getController(a.store)

    // Creating parents of the new file adds their entries too, always dirs first.
    await act(async () => {
      await c.createFile('lib/inner/new.ts')
    })
    expect(listAll).not.toHaveBeenCalled()
    expect(treePaths(a.store)).toEqual(['lib', 'lib/inner', 'lib/inner/new.ts', 'a.md'])
    expect(a.store.get(activePathAtom)).toBe('lib/inner/new.ts')
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })

    // Renaming rewrites the entry's name along with its path.
    await act(async () => {
      await c.renamePath('lib/inner/new.ts', 'lib/renamed.ts')
    })
    expect(listAll).not.toHaveBeenCalled()
    const renamed = a.store.get(treeAtom).find((e) => e.path === 'lib/renamed.ts')
    expect(renamed?.name).toBe('renamed.ts')

    await act(async () => {
      await c.renamePath('lib', 'code')
    })
    expect(listAll).not.toHaveBeenCalled()
    expect(treePaths(a.store)).toEqual(['code', 'code/inner', 'code/renamed.ts', 'a.md'])

    await act(async () => {
      await c.deletePath('code')
    })
    expect(listAll).not.toHaveBeenCalled()
    expect(treePaths(a.store)).toEqual(['a.md'])
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })

    await act(async () => {
      await c.startUntitled()
    })
    expect(listAll).not.toHaveBeenCalled()
    expect(treePaths(a.store)).toEqual(['Untitled-1.md', 'a.md'])
    expect(a.store.get(activePathAtom)).toBe('Untitled-1.md')
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })
  })

  it('falls back to a full walk when the patch cannot be applied', async () => {
    const disk = new MemDisk()
    disk.setFile('docs/a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk)
    await act(async () => {
      await getController(a.store).ensureFullTree()
    })
    const listAll = vi.spyOn(fsOf(a.store)!, 'listAll')
    // A tree snapshot missing the renamed entry (say, left stale by a crash): the
    // patch bails out and a full refresh restores the truth from the folder.
    await act(async () => {
      a.store.set(treeAtom, [])
    })

    await act(async () => {
      await getController(a.store).renamePath('docs', 'guide')
    })

    expect(listAll).toHaveBeenCalledTimes(1)
    expect(treePaths(a.store)).toEqual(['guide', 'guide/a.md'])
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })
  })

  it('Ctrl-R in the tree still refreshes fully', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    disk.setFile('docs/a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk)
    await act(async () => {
      a.store.set(sidebarOpenAtom, true)
    })
    const tree = await screen.findByRole('complementary', { name: 'File tree' })
    // Clicking a folder row keeps focus in the tree (a file row would, too, but it
    // moves focus to the editor once the file loads).
    await user.click(within(tree).getByRole('button', { name: 'docs' }))
    await act(async () => {
      await getController(a.store).ensureFullTree()
    })
    const listAll = vi.spyOn(fsOf(a.store)!, 'listAll')
    disk.setFile('other/z.md', new TextEncoder().encode('z')) // changed on disk, not by us

    await user.keyboard('{Control>}r{/Control}')

    expect(listAll).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(treePaths(a.store)).toContain('other/z.md'))
  })
})

describe('link revalidation on focus', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    lastDisk = null
  })

  const focus = () =>
    act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

  const hideDocument = () =>
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
  const unhideDocument = () => {
    // jsdom defines visibilityState on the prototype; drop the local override.
    delete (document as { visibilityState?: unknown }).visibilityState
  }

  it('a lapse seen on focus pauses the link and raises the reconnect prompt', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk, 'a.md')

    disk.access = 'prompt' // the browser stopped granting readwrite while away
    await focus()

    expect(a.store.get(linkedFolderAtom)).toEqual({
      name: 'proj',
      paused: true,
      single: false,
    })
    expect(
      await screen.findByRole('dialog', { name: 'Reconnect proj?' }),
    ).toBeInTheDocument()
  })

  it('skips revalidation while the document is hidden', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk, 'a.md')
    disk.access = 'prompt'

    await act(async () => {
      hideDocument()
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    unhideDocument()

    expect(a.store.get(linkedFolderAtom)?.paused).toBe(false)
    // Seen again with nothing skipped behind the tab: the next focus catches up.
    await focus()
    expect(a.store.get(linkedFolderAtom)?.paused).toBe(true)
  })

  it('a burst of focus and visibility events refreshes the tree exactly once', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk, 'a.md')
    const refresh = vi.spyOn(getController(a.store), 'refreshTree')
    disk.setFile('z.md', new TextEncoder().encode('z')) // an external change to pick up

    // Within the throttle window a focus does not walk the folder again.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(refresh).not.toHaveBeenCalled()

    const realNow = Date.now
    const now = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 20_000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    now.mockRestore()

    expect(refresh).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(treePaths(a.store)).toContain('z.md'))
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })
  })

  it('reports read progress while the folder is listed and clears it when ready', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    disk.setFile('b.md', new TextEncoder().encode('b'))
    const a = mount()
    await openFolder(a.store, disk, 'a.md')
    expect(a.store.get(treeProgressAtom)).toBeNull()

    const fs = fsOf(a.store)
    const real = fs.listAll.bind(fs)
    const seen: unknown[] = []
    vi.spyOn(fs, 'listAll').mockImplementation(async (onProgress) => {
      onProgress?.(1)
      seen.push(a.store.get(treeProgressAtom))
      return real(onProgress)
    })
    await act(async () => {
      await getController(a.store).ensureFullTree()
    })
    // No full read has happened yet, so the total is unknown.
    expect(seen).toEqual([{ done: 1, total: null }])
    expect(a.store.get(treeProgressAtom)).toBeNull()
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })
  })

  it('clears read progress when listing fails', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk, 'a.md')
    const fs = fsOf(a.store)
    vi.spyOn(fs, 'listAll').mockRejectedValue(new Error('boom'))
    await act(async () => {
      await getController(a.store).ensureFullTree()
    })
    expect(a.store.get(treeProgressAtom)).toBeNull()
    expect(a.store.get(treeStatusAtom).state).toBe('error')
  })

  it('ignores focus with no workspace open', async () => {
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(a.store.get(workspaceStatusAtom).state).toBe('ready')
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'no-folder' })
  })

  it('access restored while paused recovers on focus, without a click', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    disk.access = 'prompt' // lapsed before the workspace even opened
    const a = mount()
    await openFolder(a.store, disk)

    expect(a.store.get(linkedFolderAtom)?.paused).toBe(true)
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'permission' })

    disk.access = 'granted' // restored through the browser's site settings
    await focus()

    expect(a.store.get(linkedFolderAtom)?.paused).toBe(false)
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })
    expect(treePaths(a.store)).toEqual(['a.md'])
    expect(await onDisk(a.store, 'a.md')).toBe('a')
    expect(screen.queryByRole('dialog', { name: 'Reconnect proj?' })).toBeNull()
  })

  it('keeps a paused link paused while access is still missing', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    disk.access = 'prompt'
    const a = mount()
    await openFolder(a.store, disk)

    await focus()

    expect(a.store.get(linkedFolderAtom)?.paused).toBe(true)
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'permission' })
    expect(a.store.get(treeAtom)).toEqual([])
  })

  it('a workspace switched mid-revalidation bails out', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk, 'a.md')

    const second = new MemDisk()
    second.setFile('z.md', new TextEncoder().encode('z'))
    await act(async () => {
      window.dispatchEvent(new Event('focus')) // revalidation starts against `proj`
      await getController(a.store).importFolderHandle(second.handle('other') as never)
    })

    expect(a.store.get(linkedFolderAtom)).toEqual({
      name: 'other',
      paused: false,
      single: false,
    })
    expect(treePaths(a.store)).toEqual(['z.md'])
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'ready' })
  })
})

describe('single-file workspaces', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    lastDisk = null
  })

  const opener = () => screen.findByRole('region', { name: 'Workspace opener' })
  /** Opens a picked file's workspace without going through the picker. */
  async function importFile(
    store: ReturnType<typeof createStore>,
    disk: MemDisk,
    name = 'notes.md',
    data: Uint8Array = new TextEncoder().encode('hi'),
  ) {
    await act(async () => {
      await getController(store).importFileHandle(disk.fileHandle(name, data) as never)
    })
  }

  it('opens a picked file from the opener; autosave writes through the handle', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const handle = disk.fileHandle('notes.md', new TextEncoder().encode('hello'))
    vi.stubGlobal('showOpenFilePicker', async () => [handle])
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))

    await user.click(within(await opener()).getByRole('button', { name: 'Open file' }))

    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).toBeTruthy())
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('notes.md'))
    await waitFor(() =>
      expect(a.store.get(treeAtom)).toEqual([
        { name: 'notes.md', path: 'notes.md', kind: 'file', size: 5 },
      ]),
    )
    expect(await savedSession(a.store)).toMatchObject({ kind: 'file', name: 'notes.md' })

    type(a.store, '!')
    await waitFor(async () => expect(await onDisk(a.store, 'notes.md')).toBe('hello!'), {
      timeout: 3000,
    })
    vi.unstubAllGlobals()
  })

  it('Open file reports an unsupported browser instead of failing silently', async () => {
    const user = userEvent.setup()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))

    await user.click(within(await opener()).getByRole('button', { name: 'Open file' }))

    expect(await screen.findByText(/does not support opening files/)).toBeInTheDocument()
  })

  it('a notice blocks untitled files, new files and folders', async () => {
    const disk = new MemDisk()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await importFile(a.store, disk)
    const blocked = 'This workspace is a single file; open a folder to create more'

    await act(async () => {
      await getController(a.store).startUntitled()
    })
    expect(a.store.get(noticeAtom)).toEqual({ kind: 'info', text: blocked })
    expect(a.store.get(activePathAtom)).toBe('notes.md')

    await act(async () => {
      await getController(a.store).createFile('another.md')
    })
    expect(a.store.get(noticeAtom)).toEqual({ kind: 'info', text: blocked })

    await act(async () => {
      await getController(a.store).createFolder('sub')
    })
    expect(a.store.get(noticeAtom)).toEqual({ kind: 'info', text: blocked })
    expect(a.store.get(treeAtom)).toHaveLength(1)
  })

  it('opening the same file again switches to its existing workspace', async () => {
    const disk = new MemDisk()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await importFile(a.store, disk)
    const id = a.store.get(currentWorkspaceIdAtom)

    await importFile(a.store, disk) // a fresh pick of the same file

    expect(a.store.get(workspacesAtom)).toHaveLength(1)
    expect(a.store.get(currentWorkspaceIdAtom)).toBe(id)
    expect(await screen.findByText(/is already open/)).toBeInTheDocument()
  })

  it('a failed save pauses the link, and reconnecting restores access', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await importFile(a.store, disk)
    disk.access = 'prompt'

    type(a.store, '!')
    await waitFor(() => expect(a.store.get(linkedFolderAtom)?.paused).toBe(true), {
      timeout: 3000,
    })
    expect(
      await screen.findByRole('dialog', { name: 'Reconnect notes.md?' }),
    ).toBeInTheDocument()

    disk.access = 'granted'
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Reconnect' }),
    )
    expect(await screen.findByText(/Connected "notes\.md"/)).toBeInTheDocument()
    expect(a.store.get(linkedFolderAtom)?.paused).toBe(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('restores the single file after a reload', async () => {
    const disk = new MemDisk()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await importFile(a.store, disk, 'notes.md', new TextEncoder().encode('hello'))
    type(a.store, ' world')
    await waitFor(
      async () => expect(await onDisk(a.store, 'notes.md')).toBe('hello world'),
      { timeout: 3000 },
    )
    getController(a.store).flushOnHide()
    await waitFor(async () =>
      expect((await savedSession(a.store))?.openFiles).toEqual(['notes.md']),
    )
    a.unmount()

    const b = mount()
    await waitFor(() => expect(b.store.get(workspaceStatusAtom).state).toBe('ready'))
    await waitFor(() => expect(b.store.get(activePathAtom)).toBe('notes.md'))
    await waitFor(() =>
      expect(b.store.get(editorHandleAtom)!.view.state.doc.toString()).toBe(
        'hello world',
      ),
    )
  })

  it('prune and delete treat the file workspace like any other', async () => {
    const disk = new MemDisk()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await importFile(a.store, disk)
    const id = a.store.get(currentWorkspaceIdAtom)!

    const manager = new WorkspaceManager(await openDB())
    const kept = await manager.pruneUnlinked()
    expect(kept.map((w) => w.id)).toEqual([id]) // not pruned as unlinked

    await act(async () => {
      await getController(a.store).deleteWorkspace(id)
    })
    expect(a.store.get(workspacesAtom)).toEqual([])
    expect(a.store.get(treeStatusAtom)).toEqual({ state: 'no-folder' })
    expect(await new WorkspaceManager(await openDB()).list()).toEqual([])
  })

  it('a folder and a file with the same name are separate workspaces', async () => {
    const folderDisk = new MemDisk()
    folderDisk.setFile('proj/a.md', new TextEncoder().encode('A'))
    const fileDisk = new MemDisk()
    const a = mount()
    await openFolder(a.store, folderDisk)
    const folderId = a.store.get(currentWorkspaceIdAtom)

    await act(async () => {
      await getController(a.store).importFileHandle(
        fileDisk.fileHandle('proj', new TextEncoder().encode('P')) as never,
      )
    })

    // Not the folder's record: its own kind 'file' workspace, keyed apart from it.
    expect(a.store.get(workspacesAtom)).toHaveLength(2)
    const fileId = a.store.get(currentWorkspaceIdAtom)
    expect(fileId).not.toBe(folderId)
    expect(a.store.get(treeAtom)).toEqual([
      { name: 'proj', path: 'proj', kind: 'file', size: 1 },
    ])
    expect(await onDisk(a.store, 'proj')).toBe('P')

    // Both routes keep working: no record lost its link key to the other kind.
    await act(async () => {
      await getController(a.store).switchTo(folderId!)
    })
    expect(treePaths(a.store)).toEqual(['proj', 'proj/a.md'])
    expect(await onDisk(a.store, 'proj/a.md')).toBe('A')
    expect(a.store.get(linkedFolderAtom)?.paused).toBe(false)

    await act(async () => {
      await getController(a.store).switchTo(fileId!)
    })
    expect(a.store.get(treeAtom)).toHaveLength(1)
    expect(await onDisk(a.store, 'proj')).toBe('P')
  })
})

describe('rename across a workspace switch', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    lastDisk = null
  })

  it('a switch during a stalled rename leaves the new workspace alone', async () => {
    const disk = new MemDisk()
    disk.setFile('a.md', new TextEncoder().encode('a'))
    const a = mount()
    await openFolder(a.store, disk, 'a.md')
    // Both workspaces have an a.md: the pre-guard damage would rename the wrong one.
    const second = new MemDisk()
    second.setFile('a.md', new TextEncoder().encode('second'))
    const fs = fsOf(a.store)!
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(fs, 'rename').mockImplementation(async () => {
      await gate // the disk write is in flight while the user moves on
    })

    const c = getController(a.store)
    await act(async () => {
      const pending = c.renamePath('a.md', 'b.md')
      await c.importFolderHandle(second.handle('other') as never) // switch mid-rename
      release()
      await pending
    })

    // The new workspace keeps its own buffer, tab and path; nothing became b.md.
    expect(treePaths(a.store)).toEqual(['a.md'])
    expect(a.store.get(openBuffersAtom).map((b) => b.path)).toEqual(['a.md'])
    expect(a.store.get(activePathAtom)).toBe('a.md')
    expect(await onDisk(a.store, 'a.md')).toBe('second')
    getController(a.store).flushOnHide()
    await waitFor(async () =>
      expect((await savedSession(a.store))?.openFiles).toEqual(['a.md']),
    )
  })
})

// Last on purpose: restoring the setup's link mocks here would affect the suites above.
describe('single-file link storage shape', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    // The link mocks in test-setup hide the real IndexedDB shapes under test.
    vi.restoreAllMocks()
  })

  it('keeps file handles under flink:, leaves link: for folders, prunes with either', async () => {
    const db = await openDB()
    const manager = new WorkspaceManager(db)
    const folder = await manager.create('proj', 'folder-source')
    expect(folder.kind).toBeUndefined() // kind is present only for file workspaces

    const file = await manager.create('notes.md', 'file-source', 'file')
    expect(file.kind).toBe('file')
    await manager.setFileLink(file.id, new MemDisk().fileHandle('notes.md') as never)

    // The raw handle lands under the flink key only; the link key stays folder-only.
    expect(await manager.getLink(file.id)).toBeUndefined()
    expect(await idbGet(db, 'settings', linkKey(file.id))).toBeUndefined()
    expect(
      await idbGet<{ kind: string; name: string }>(db, 'settings', fileLinkKey(file.id)),
    ).toMatchObject({ kind: 'file', name: 'notes.md' })
    expect((await manager.getFileLink(file.id))?.name).toBe('notes.md')

    const kept = await manager.pruneUnlinked()
    expect(kept.map((w) => w.id)).toEqual([file.id])

    await manager.remove(file.id)
    expect(await manager.getFileLink(file.id)).toBeUndefined()
    expect(await idbGet(db, 'settings', fileLinkKey(file.id))).toBeUndefined()
    expect((await manager.list()).map((w) => w.id)).not.toContain(file.id)
  })
})
