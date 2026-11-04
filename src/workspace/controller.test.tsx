import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import { vi } from 'vitest'
import App from '../App'
import { editorHandleAtom, paletteOpenAtom } from '../state/editorAtoms'
import { runEx } from '../editor/testing/runEx'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  sidebarOpenAtom,
  treeAtom,
  workspacesAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { AUTOSAVE_MS, getController } from './controller'
import { openDB } from './db'
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

    await user.click(within(tree).getByRole('button', { name: 'Rename main.ts' }))
    await user.type(
      within(tree).getByLabelText('Rename main.ts'),
      '{Control>}a{/Control}app.ts{Enter}',
    )
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('src/deep/app.ts'))
    expect(await onDisk(a.store, 'src/deep/app.ts')).toBe('')

    const deleteApp = await within(tree).findByRole('button', { name: 'Delete app.ts' })
    const appRow = deleteApp.closest<HTMLElement>('li[role="treeitem"]')!
    await user.click(deleteApp)
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

  it('opens settings with storage details', async () => {
    const user = userEvent.setup()
    mount()
    await waitFor(() => expect(screen.queryByText(/Open folder/)).toBeInTheDocument())
    await user.keyboard('{Control>},{/Control}')
    const dlg = await screen.findByRole('dialog', { name: 'Settings' })
    expect(await within(dlg).findByText(/Persistent storage/)).toBeInTheDocument()
    expect(within(dlg).queryByText(/OPFS/)).not.toBeInTheDocument()
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
    for (const label of [
      'Command Palette',
      'Search Files',
      'New Scratch Buffer',
      'Switch Workspace',
    ])
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

  it('searches files from the blank page with the tree finder, and opens the chosen one', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    disk.setFile('src/app.ts', new TextEncoder().encode('export {}'))
    disk.setFile('README.md', new TextEncoder().encode('# r'))
    const a = mount()
    await openFolder(a.store, disk, 'README.md')
    await act(async () => {
      getController(a.store).showHome()
    })
    expect(a.store.get(activePathAtom)).toBeNull()

    const o = await opener()
    await user.type(within(o).getByRole('textbox', { name: 'Search files' }), 'app')
    expect(a.store.get(activePathAtom)).toBeNull()
    await user.click(within(o).getByRole('option', { name: /app\.ts/ }))

    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('src/app.ts'))
  })

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
})

describe('blank install', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    lastDisk = null
  })

  const opener = () => screen.findByRole('region', { name: 'Workspace opener' })
  const treePaths = (store: ReturnType<typeof createStore>) =>
    store.get(treeAtom).map((e) => e.path)

  it('opens a new install to the opener, with no files', async () => {
    const a = mount()
    expect(await opener()).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    expect(treePaths(a.store)).toEqual([])
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
    await openFolder(a.store, disk, 'docs/a.md')
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    await user.type(
      within(tree).getByRole('textbox', { name: 'Find a file' }),
      'main{Enter}',
    )
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('main.ts'))
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
    await waitFor(() => expect(screen.queryByText(/Open folder/)).toBeInTheDocument())
    await user.keyboard('{Shift}{/Shift}{Shift}{/Shift}')
    expect((await screen.findByRole('combobox')) as HTMLInputElement).toHaveValue('>')
    await user.keyboard('{Escape}')
  })
})
