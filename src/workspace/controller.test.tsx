import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { strToU8, zipSync } from 'fflate'
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
import { OpfsBackend } from './opfs'
import { getMemoryOpfs } from './testing/opfsSetup'

/** The workspace record in IndexedDB, bypassing the app. */
async function savedSession(store: ReturnType<typeof createStore>) {
  const db = await openDB()
  const root = getMemoryOpfs().rootHandle()
  return new WorkspaceManager(db, new OpfsBackend(root, db)).get(
    store.get(currentWorkspaceIdAtom)!,
  )
}

/** The store of the most recent `mount()`, for helpers that take no arguments. */
let lastStore: ReturnType<typeof createStore> | null = null

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

/** Reads straight from storage, bypassing the app. */
async function onDisk(store: ReturnType<typeof createStore>, path: string) {
  const db = await openDB()
  const fs = new OpfsBackend(getMemoryOpfs().rootHandle(), db).open(
    store.get(currentWorkspaceIdAtom)!,
  )
  return fs.read(path)
}

const tab = (name: string) => screen.findByRole('tab', { name: new RegExp(`^${name}`) })

/**
 * Blank workspaces open to the opener, with no files. Tests that need an editor tab
 * create `scratch.ts` first, unless it is already in the tree.
 */
async function scratchTab() {
  const store = lastStore!
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  if (!store.get(treeAtom).some((e) => e.path === 'scratch.ts')) {
    await act(async () => {
      await getController(store).createFile('scratch.ts')
    })
  }
  return tab('scratch.ts')
}

describe('workspace in the app', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('creates a scratch file, saves with Mod-S, and restores after a reload', async () => {
    const user = userEvent.setup()
    const a = mount()
    await scratchTab()
    type(a.store, 'hello')
    expect(await screen.findByLabelText('unsaved')).toBeInTheDocument()
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() =>
      expect(screen.queryByLabelText('unsaved')).not.toBeInTheDocument(),
    )
    expect(await onDisk(a.store, 'scratch.ts')).toBe('hello')
    getController(a.store).flushOnHide() // what pagehide does; the session save is debounced
    await waitFor(async () =>
      expect((await savedSession(a.store))?.openFiles).toEqual(['scratch.ts']),
    )
    a.unmount()

    const b = mount() // new store, same IndexedDB: a page reload
    await scratchTab()
    await waitFor(() =>
      expect(b.store.get(editorHandleAtom)!.view.state.doc.toString()).toBe('hello'),
    )
  })

  it('autosaves after a pause', async () => {
    const a = mount()
    await scratchTab()
    type(a.store, 'auto')
    await waitFor(async () => expect(await onDisk(a.store, 'scratch.ts')).toBe('auto'), {
      timeout: 3000,
    })
  })

  it('discarding a tab drops its unsaved edits and never writes them', async () => {
    const a = mount()
    await scratchTab()
    type(a.store, 'draft')
    await act(() => getController(a.store).discardBuffer('scratch.ts'))
    await new Promise((r) => setTimeout(r, AUTOSAVE_MS + 200))
    expect(await onDisk(a.store, 'scratch.ts')).toBe('')
    expect(screen.queryByRole('tab', { name: /^scratch\.ts/ })).toBeNull()
  })

  it('Ctrl-W W switches focus between the tree and editor without closing the tree', async () => {
    const user = userEvent.setup()
    const a = mount()
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

  it('opens the first file when a folder is opened', async () => {
    const user = userEvent.setup()
    const app = mount()
    const file = new File(['folder content'], 'main.ts', { type: 'text/plain' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'demo/main.ts' })

    await user.click(await screen.findByRole('button', { name: 'Open folder' }))
    // The header and the opener each render a hidden folder input; the header's comes first.
    await user.upload(screen.getAllByLabelText('Folder to open')[0]!, file)

    await waitFor(() => expect(app.store.get(activePathAtom)).toBe('main.ts'))
    expect(app.store.get(editorHandleAtom)!.view.state.doc.toString()).toBe(
      'folder content',
    )
    expect(
      await screen.findByRole('complementary', { name: 'File tree' }),
    ).toBeInTheDocument()
  })

  it('creates, renames and deletes nested files from the tree', async () => {
    const user = userEvent.setup()
    const a = mount()
    await scratchTab()
    act(() => runEx(a.store.get(editorHandleAtom)!.view, 'Explore'))
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    // New entries come from the tree's right-click menu, on the empty space at the root.
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
    const a = mount()
    const t = await scratchTab()
    expect(a.store.get(activePathAtom)).toBe('scratch.ts')

    await user.click(screen.getByRole('button', { name: 'Home' }))

    expect(
      await screen.findByRole('region', { name: 'Workspace opener' }),
    ).toBeInTheDocument()
    expect(a.store.get(activePathAtom)).toBeNull()
    expect(t).toBeInTheDocument()
    // Clicking the tab brings the file back.
    await user.click(t)
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('scratch.ts'))
  })

  it('opens settings with storage details', async () => {
    const user = userEvent.setup()
    mount()
    await scratchTab()
    await user.keyboard('{Control>},{/Control}')
    const dlg = await screen.findByRole('dialog', { name: 'Settings' })
    expect(await within(dlg).findByText(/Persistent storage/)).toBeInTheDocument()
    expect(within(dlg).getByText(/OPFS/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('workspace opener (editor empty state)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  /** A blank workspace has no open file, so the opener shows. */
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

  it('shows the workspace name as the only heading, with no buttons or cards', async () => {
    const a = mount()
    await emptyWorkspace(a.store)
    const o = await opener()
    expect(within(o).getByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
    expect(within(o).queryAllByRole('button')).toHaveLength(0)
  })

  it('Mod-O lists workspace commands; Workspace: New opens a new workspace', async () => {
    const user = userEvent.setup()
    const a = mount()
    await emptyWorkspace(a.store)
    const original = a.store.get(currentWorkspaceIdAtom)

    await user.keyboard('{Control>}o{/Control}')
    expect(screen.getByRole('option', { name: 'Workspace: New' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Workspace: New' }))

    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).not.toBe(original))
    await emptyWorkspace(a.store)
    expect(a.store.get(treeAtom)).toEqual([])

    await user.keyboard('{Control>}o{/Control}')
    await user.click(
      screen.getByRole('option', { name: 'Workspace: Switch to Workspace' }),
    )
    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).toBe(original))
  })

  it('searches files from the blank page with the tree finder, and opens the chosen one', async () => {
    const user = userEvent.setup()
    const a = mount()
    await emptyWorkspace(a.store)
    await act(async () => {
      await getController(a.store).importZipFile(
        new File(
          [zipSync({ 'src/app.ts': strToU8('export {}'), 'README.md': strToU8('# r') })],
          'finder.zip',
          { type: 'application/zip' },
        ),
      )
    })
    await act(async () => {
      getController(a.store).showHome()
    })
    expect(a.store.get(activePathAtom)).toBeNull()

    const o = await opener()
    await user.type(within(o).getByRole('textbox', { name: 'Search files' }), 'app')
    // Typing in the search box is not a keystroke for a new untitled file.
    expect(a.store.get(activePathAtom)).toBeNull()
    await user.click(within(o).getByRole('option', { name: /app\.ts/ }))

    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('src/app.ts'))
  })

  it('unpacks a dropped zip into a new workspace and opens its first file', async () => {
    const a = mount()
    await emptyWorkspace(a.store)
    const zip = new File([zipSync({ 'app.ts': strToU8('zipped') })], 'demo.zip', {
      type: 'application/zip',
    })
    fireEvent.drop(await opener(), { dataTransfer: { files: [zip], types: ['Files'] } })

    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('app.ts'))
    expect(a.store.get(editorHandleAtom)!.view.state.doc.toString()).toBe('zipped')
  })

  it('explains when a dropped file is not a single zip', async () => {
    const a = mount()
    await emptyWorkspace(a.store)
    const txt = new File(['plain'], 'notes.txt', { type: 'text/plain' })
    fireEvent.drop(await opener(), { dataTransfer: { files: [txt], types: ['Files'] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Drop a single .zip archive',
    )
    expect(a.store.get(activePathAtom)).toBeNull()
  })

  it('a key typed on the blank page starts Untitled-1.md with that text', async () => {
    const a = mount()
    await emptyWorkspace(a.store)

    // Both keys arrive before the file has opened: neither may be lost.
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
    const a = mount()
    await emptyWorkspace(a.store)

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
  })

  async function emptyWorkspace(store: ReturnType<typeof createStore>) {
    await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
    expect(store.get(activePathAtom)).toBeNull()
  }

  const zip = (files: Record<string, string>) =>
    new File(
      [
        zipSync(
          Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
        ),
      ],
      'proj.zip',
      { type: 'application/zip' },
    )

  it('switches to the existing workspace instead of adding a duplicate', async () => {
    const a = mount()
    const c = getController(a.store)
    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).toBeTruthy())
    await act(async () => {
      await c.importZipFile(zip({ 'a.ts': 'A' }))
    })
    const first = a.store.get(currentWorkspaceIdAtom)
    await act(async () => {
      await c.switchTo(
        a.store.get(workspacesAtom).find((w) => w.name === 'Workspace')!.id,
      )
    })
    await act(async () => {
      await c.importZipFile(zip({ 'a.ts': 'A again' }))
    })

    expect(a.store.get(workspacesAtom).filter((w) => w.name === 'proj')).toHaveLength(1)
    expect(a.store.get(currentWorkspaceIdAtom)).toBe(first)
    expect(await screen.findByText(/is already open/)).toBeInTheDocument()
  })

  it('keeps a different folder with the same name as its own workspace', async () => {
    const a = mount()
    const c = getController(a.store)
    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).toBeTruthy())
    await act(async () => {
      await c.importZipFile(zip({ 'a.ts': 'A' }))
    })
    await act(async () => {
      await c.importZipFile(zip({ 'b.ts': 'B' }))
    })
    expect(a.store.get(workspacesAtom).filter((w) => w.name === 'proj')).toHaveLength(2)
  })

  it('deletes the current workspace from the palette only after confirmation', async () => {
    const user = userEvent.setup()
    const a = mount()
    await emptyWorkspace(a.store)
    const original = a.store.get(currentWorkspaceIdAtom)!
    await act(async () => {
      await getController(a.store).newWorkspace()
    })
    await emptyWorkspace(a.store)
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
    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).toBe(original))
  })
})

describe('command palette modes', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  const zipOf = (files: Record<string, string>) =>
    new File(
      [
        zipSync(
          Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
        ),
      ],
      'modes.zip',
      { type: 'application/zip' },
    )

  async function withFiles(store: ReturnType<typeof createStore>) {
    const c = getController(store)
    await waitFor(() => expect(store.get(currentWorkspaceIdAtom)).toBeTruthy())
    await act(async () => {
      await c.importZipFile(zipOf({ 'src/app.ts': 'export {}', 'README.md': '# readme' }))
    })
    return c
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

describe('opening a folder shows a loading state', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  /** A zip whose contents are held back until `release` is called, so the import can be paused. */
  function gatedZip(files: Record<string, string>, name = 'proj.zip') {
    const bytes = zipSync(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
    )
    const file = new File([bytes], name, { type: 'application/zip' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => {
        await gate
        return bytes.slice().buffer
      },
    })
    return { file, release }
  }

  const overlay = () => screen.queryByRole('status', { name: 'Opening folder' })

  it('covers the blank scratch page until the folder is open, then replaces it', async () => {
    const a = mount()
    await scratchTab()
    const c = getController(a.store)
    const { file, release } = gatedZip({ 'app.ts': 'zipped', 'lib/util.ts': 'util' })

    void c.importZipFile(file)

    const status = await screen.findByRole('status', { name: 'Opening folder' })
    expect(within(status).getByRole('heading', { name: 'proj' })).toBeInTheDocument()
    expect(within(status).getByText('Reading files')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /^scratch/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeDisabled()
    expect(screen.getByTestId('editor')).toHaveAttribute('inert')

    await act(async () => {
      release()
    })
    await waitFor(() => expect(overlay()).toBeNull())
    expect(a.store.get(activePathAtom)).toBe('app.ts')
    expect(a.store.get(editorHandleAtom)!.view.state.doc.toString()).toBe('zipped')
    expect(await tab('app.ts')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /^scratch/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled()
    expect(screen.getByTestId('editor')).not.toHaveAttribute('inert')
  })

  it('brings the scratch file back when the folder cannot be read', async () => {
    const a = mount()
    await scratchTab()
    const c = getController(a.store)

    await act(async () => {
      await c.importZipFile(new File(['not a zip'], 'broken.zip'))
    })

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(overlay()).toBeNull()
    expect(a.store.get(activePathAtom)).toBe('scratch.ts')
    expect(screen.getByTestId('editor')).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled()
  })

  it('refuses a second folder while one is still opening', async () => {
    const a = mount()
    await scratchTab()
    const c = getController(a.store)
    const first = gatedZip({ 'one.ts': '1' })
    const second = gatedZip({ 'two.ts': '2' }, 'other.zip')

    void c.importZipFile(first.file)
    await screen.findByRole('status', { name: 'Opening folder' })
    await act(async () => {
      await c.importZipFile(second.file)
    })

    expect(await screen.findByText(/Another folder is still opening/)).toBeInTheDocument()
    expect(a.store.get(workspacesAtom).some((w) => w.name === 'other')).toBe(false)

    await act(async () => {
      first.release()
    })
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('one.ts'))
    await waitFor(() => expect(overlay()).toBeNull())
  })
})

describe('blank workspaces', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
  })

  /** A blank workspace as older builds left it, with a scratch.ts, opened last. */
  async function legacyWorkspace(text: string) {
    const db = await openDB()
    const root = getMemoryOpfs().rootHandle()
    const m = new WorkspaceManager(db, new OpfsBackend(root, db))
    const meta = await m.create('Legacy')
    await m.fs(meta.id).write('scratch.ts', text)
    await m.setLastId(meta.id)
  }

  const treePaths = (store: ReturnType<typeof createStore>) =>
    store.get(treeAtom).map((e) => e.path)
  const opener = () => screen.findByRole('region', { name: 'Workspace opener' })

  it('opens a new install to the opener, with no files', async () => {
    const a = mount()
    expect(await opener()).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    expect(treePaths(a.store)).toEqual([])
  })

  it('opens :Explore from the blank page instead of starting an untitled file', async () => {
    const user = userEvent.setup()
    const a = mount()
    expect(await opener()).toBeInTheDocument()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))

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
    expect(treePaths(a.store)).toEqual([])
    expect(a.store.get(activePathAtom)).toBeNull()
  })

  it('removes an untouched placeholder scratch.ts when the workspace opens', async () => {
    await legacyWorkspace('')
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    expect(treePaths(a.store)).toEqual([])
    expect(await opener()).toBeInTheDocument()
  })

  it('keeps a scratch.ts that has text in it', async () => {
    await legacyWorkspace('notes')
    const a = mount()
    await waitFor(() => expect(treePaths(a.store)).toEqual(['scratch.ts']))
    expect(await onDisk(a.store, 'scratch.ts')).toBe('notes')
  })

  it('checks a blank workspace once, so a later empty scratch.ts is kept', async () => {
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await act(async () => {
      await getController(a.store).createFile('scratch.ts')
    })
    a.unmount()

    const b = mount() // reload: the workspace is opened again
    await waitFor(() => expect(b.store.get(workspaceStatusAtom).state).toBe('ready'))
    expect(treePaths(b.store)).toEqual(['scratch.ts'])
  })
})

describe('tree context menu', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('creates in the right-clicked folder, and at the root from empty space', async () => {
    const user = userEvent.setup()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await act(async () => {
      await getController(a.store).importZipFile(
        new File(
          [zipSync({ 'docs/a.md': strToU8('a'), 'main.ts': strToU8('m') })],
          'proj.zip',
        ),
      )
    })
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    fireEvent.contextMenu(within(tree).getByRole('button', { name: 'docs' }))
    await user.click(await screen.findByRole('menuitem', { name: 'New file' }))
    await user.type(within(tree).getByLabelText('New file name'), 'b.ts{Enter}')
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('docs/b.ts'))

    fireEvent.contextMenu(tree) // empty space, not a row: the root menu
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
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await act(async () => {
      await getController(a.store).importZipFile(
        new File([zipSync({ 'docs/a.md': strToU8('a') })], 'proj.zip'),
      )
    })
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
  })

  it('opens the highlighted file from the search box', async () => {
    const user = userEvent.setup()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await act(async () => {
      await getController(a.store).importZipFile(
        new File(
          [zipSync({ 'docs/a.md': strToU8('a'), 'main.ts': strToU8('m') })],
          'proj.zip',
        ),
      )
    })
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    await user.type(
      within(tree).getByRole('textbox', { name: 'Find a file' }),
      'main{Enter}',
    )
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('main.ts'))
  })
})

describe('zip root folder', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('shows the contents of a compressed folder at the workspace root', async () => {
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await act(async () => {
      await getController(a.store).importZipFile(
        new File(
          [zipSync({ 'proj/src/main.ts': strToU8('m'), 'proj/README.md': strToU8('r') })],
          'proj.zip',
        ),
      )
    })
    await waitFor(() => expect(a.store.get(treeAtom).length).toBeGreaterThan(0))
    expect(
      a.store
        .get(treeAtom)
        .map((e) => e.path)
        .sort(),
    ).toEqual(['README.md', 'src', 'src/main.ts'])
  })
})

describe('double Shift', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('opens the command palette in command mode', async () => {
    const user = userEvent.setup()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    await user.keyboard('{Shift}{/Shift}{Shift}{/Shift}')
    expect((await screen.findByRole('combobox')) as HTMLInputElement).toHaveValue('>')
    await user.keyboard('{Escape}')
  })
})

describe('optimistic folder import', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
  })

  /** A folder file whose bytes are held back until `release`, so its copy can be paused. */
  function gatedFile(relPath: string, content: string) {
    const f = new File([content], relPath.split('/').pop()!)
    Object.defineProperty(f, 'webkitRelativePath', { value: `proj/${relPath}` })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    Object.defineProperty(f, 'arrayBuffer', {
      value: async () => {
        await gate
        return new TextEncoder().encode(content).buffer
      },
    })
    return { file: f, release }
  }

  const row = (tree: HTMLElement, name: string) =>
    within(tree).getByRole('button', { name })

  it('opens the first file and lists the rest as still copying', async () => {
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    const first = { file: new File(['A'], 'a.ts') }
    Object.defineProperty(first.file, 'webkitRelativePath', { value: 'proj/a.ts' })
    const b = gatedFile('b.ts', 'B')
    const c = gatedFile('c.ts', 'C')
    await act(async () => {
      await getController(a.store).importFolderFiles([first.file, b.file, c.file])
    })

    expect(a.store.get(activePathAtom)).toBe('a.ts')
    const tree = await screen.findByRole('complementary', { name: 'File tree' })
    expect(row(tree, 'b.ts')).toHaveAttribute('aria-description', 'Copying')
    expect(row(tree, 'c.ts')).toHaveAttribute('aria-description', 'Copying')
    b.release()
    c.release()
  })

  it('opening a file that is still copying copies it first', async () => {
    const user = userEvent.setup()
    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    const first = new File(['A'], 'a.ts')
    Object.defineProperty(first, 'webkitRelativePath', { value: 'proj/a.ts' })
    const b = gatedFile('b.ts', 'B')
    const c = gatedFile('c.ts', 'C')

    await act(async () => {
      await getController(a.store).importFolderFiles([first, b.file, c.file])
    })
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    await user.click(row(tree, 'c.ts'))
    c.release() // c is copied next, while b stays pending
    await waitFor(() => expect(a.store.get(activePathAtom)).toBe('c.ts'))
    expect(a.store.get(editorHandleAtom)!.view.state.doc.toString()).toBe('C')
    expect(row(tree, 'b.ts')).toHaveAttribute('aria-description', 'Copying')
    b.release()
  })
})

describe('interrupted imports', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
  })

  it('removes a copy that was left unfinished when the page closed', async () => {
    const db = await openDB()
    const root = getMemoryOpfs().rootHandle()
    const m = new WorkspaceManager(db, new OpfsBackend(root, db))
    const meta = await m.create('Half', 'source-key', true)
    await m.fs(meta.id).write('partial.ts', 'x')
    await m.setLastId(meta.id)

    const a = mount()
    await waitFor(() => expect(a.store.get(workspaceStatusAtom).state).toBe('ready'))
    expect(a.store.get(workspacesAtom).map((w) => w.name)).not.toContain('Half')
    expect(await screen.findByText(/did not finish/)).toBeInTheDocument()
  })
})
