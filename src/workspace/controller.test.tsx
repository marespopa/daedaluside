import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { strToU8, zipSync } from 'fflate'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { editorHandleAtom, paletteOpenAtom } from '../state/editorAtoms'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  treeAtom,
  workspacesAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { getController } from './controller'
import { openDB } from './db'
import { IdbBackend } from './fallback-idb'
import { WorkspaceManager } from './manager'

/** The workspace record in IndexedDB, bypassing the app. */
async function savedSession(store: ReturnType<typeof createStore>) {
  const db = await openDB()
  return new WorkspaceManager(db, new IdbBackend(db)).get(
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
  const fs = new IdbBackend(await openDB()).open(store.get(currentWorkspaceIdAtom)!)
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
    await user.keyboard('{Control>}b{/Control}')
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    await user.click(screen.getByRole('button', { name: 'New file' }))
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

  it('opens settings with storage details', async () => {
    const user = userEvent.setup()
    mount()
    await scratchTab()
    await user.keyboard('{Control>},{/Control}')
    const dlg = await screen.findByRole('dialog', { name: 'Settings' })
    expect(await within(dlg).findByText(/Persistent storage/)).toBeInTheDocument()
    expect(within(dlg).getByText(/IndexedDB/)).toBeInTheDocument()
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
    expect(await opener()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Open local folder/ })).toBeEnabled()
    expect(
      within(await opener()).getByText(/^(OPFS|IndexedDB) · on this device$/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names the open workspace instead of asking to open one', async () => {
    const user = userEvent.setup()
    const a = mount()
    await emptyWorkspace(a.store)
    const o = await opener()
    expect(within(o).getByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
    expect(within(o).queryByText('Open a workspace')).toBeNull()
    expect(
      within(o).getByText(/0 files in this workspace, none open/),
    ).toBeInTheDocument()

    await user.click(within(o).getByRole('button', { name: 'Show file tree' }))
    expect(
      await screen.findByRole('complementary', { name: 'File tree' }),
    ).toBeInTheDocument()
  })

  it('creates a named workspace inline and lists it under recents', async () => {
    const user = userEvent.setup()
    const a = mount()
    await emptyWorkspace(a.store)
    const original = a.store.get(currentWorkspaceIdAtom)
    await user.click(await screen.findByRole('button', { name: /^New workspace/ }))
    await user.type(screen.getByLabelText('Workspace name'), 'Fresh{Enter}')

    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).not.toBe(original))
    await emptyWorkspace(a.store)
    expect(a.store.get(treeAtom)).toEqual([])
    const fresh = a.store.get(currentWorkspaceIdAtom)
    expect(fresh).not.toBe(original)

    const recents = await screen.findByRole('region', { name: 'Recent workspaces' })
    expect(within(recents).getByRole('button', { name: /^Fresh/ })).toBeInTheDocument()
    await user.click(within(recents).getByRole('button', { name: /^Workspace/ }))
    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).toBe(original))
  })

  it('cancels the inline name field with Escape', async () => {
    const user = userEvent.setup()
    const a = mount()
    await emptyWorkspace(a.store)
    await user.click(await screen.findByRole('button', { name: /^New workspace/ }))
    await user.type(screen.getByLabelText('Workspace name'), 'Nope{Escape}')
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^New workspace/ })).toBeInTheDocument()
    expect(a.store.get(activePathAtom)).toBeNull()
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

  it('removes a recent workspace after a second click on Delete', async () => {
    const user = userEvent.setup()
    const a = mount()
    await emptyWorkspace(a.store)
    await user.click(await screen.findByRole('button', { name: /^New workspace/ }))
    await user.type(screen.getByLabelText('Workspace name'), 'Fresh{Enter}')
    await waitFor(() => expect(a.store.get(currentWorkspaceIdAtom)).not.toBeNull())
    await emptyWorkspace(a.store)

    const recents = await screen.findByRole('region', { name: 'Recent workspaces' })
    await user.click(
      within(recents).getByRole('button', { name: /^Delete workspace Fresh/ }),
    )
    await user.click(within(recents).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(within(recents).queryByRole('button', { name: /^Fresh/ })).toBeNull(),
    )
    expect(a.store.get(workspacesAtom).some((w) => w.name === 'Fresh')).toBe(false)
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
    const m = new WorkspaceManager(db, new IdbBackend(db))
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
})
