import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { editorHandleAtom } from '../state/editorAtoms'
import { openDB } from './db'
import { IdbBackend } from './fallback-idb'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  linkedFolderAtom,
  copyStatusAtom,
  sidebarOpenAtom,
  treeAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { getController } from './controller'
import { WorkspaceManager } from './manager'
import { MemDisk } from './testing/memoryDisk'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array | undefined) => (u ? new TextDecoder().decode(u) : undefined)

/**
 * Linked folders live in IndexedDB in the app. The test handle is not structured-cloneable,
 * so the link store is a map here. It still behaves as persistence across mounts.
 */
let links: Map<string, unknown>

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  links = new Map()
  vi.spyOn(WorkspaceManager.prototype, 'getLink').mockImplementation(
    async (id) => links.get(id) as never,
  )
  vi.spyOn(WorkspaceManager.prototype, 'setLink').mockImplementation(async (id, h) => {
    links.set(id, h)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mount() {
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  return store
}

async function ready(store: ReturnType<typeof createStore>) {
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
}

/** Opens a folder the way the picker does: linked, with its first file in the editor. */
async function openFolder(
  store: ReturnType<typeof createStore>,
  disk: MemDisk,
  firstFile: string,
) {
  await ready(store)
  await act(async () => {
    await getController(store).importFolderHandle(disk.handle() as never)
  })
  await waitFor(() => expect(store.get(activePathAtom)).toBe(firstFile))
  // The rest copies in the background; wait for it, or a remount would discard the import.
  await waitFor(() => expect(store.get(copyStatusAtom)).toBeNull())
}

function sampleDisk() {
  const disk = new MemDisk()
  disk.dirs.add('src')
  disk.files.set('src/a.ts', enc('export const a = 1\n'))
  disk.files.set('README.md', enc('# hi\n'))
  return disk
}

function typeAtStart(store: ReturnType<typeof createStore>, text: string) {
  const v = store.get(editorHandleAtom)!.view
  act(() => v.dispatch({ changes: { from: 0, insert: text } }))
}

describe('write-back to a linked folder', () => {
  it('a folder picked from disk is linked, and saves are written to it', async () => {
    const disk = sampleDisk()
    const store = mount()
    await openFolder(store, disk, 'README.md')
    expect(store.get(linkedFolderAtom)).toEqual({ name: 'proj', paused: false })

    typeAtStart(store, 'Edited. ')
    await act(() => getController(store).saveActive())

    expect(dec(disk.files.get('README.md'))).toBe('Edited. # hi\n')
  })

  it('creates, renames and deletes from the tree on disk too', async () => {
    const user = userEvent.setup()
    const disk = sampleDisk()
    const store = mount()
    await openFolder(store, disk, 'README.md')
    const tree = await screen.findByRole('complementary', { name: 'File tree' })
    await user.click(within(tree).getByRole('button', { name: 'Expand all folders' }))

    fireEvent.contextMenu(tree)
    await user.click(await screen.findByRole('menuitem', { name: 'New file' }))
    await user.type(within(tree).getByLabelText('New file name'), 'lib/b.ts{Enter}')
    await waitFor(() => expect(disk.files.has('lib/b.ts')).toBe(true))

    fireEvent.contextMenu(tree)
    await user.click(await screen.findByRole('menuitem', { name: 'New folder' }))
    await user.type(within(tree).getByLabelText('New folder name'), 'empty{Enter}')
    await waitFor(() => expect(disk.dirs.has('empty')).toBe(true))

    await user.click(within(tree).getByRole('button', { name: 'Rename a.ts' }))
    await user.type(
      within(tree).getByLabelText('Rename a.ts'),
      '{Control>}a{/Control}c.ts{Enter}',
    )
    await waitFor(() => expect(disk.files.has('src/c.ts')).toBe(true))
    expect(disk.files.has('src/a.ts')).toBe(false)
    expect(dec(disk.files.get('src/c.ts'))).toBe('export const a = 1\n')

    // The trash button leaves the DOM once the row asks to confirm, so keep the row itself.
    const deleteB = await within(tree).findByRole('button', { name: 'Delete b.ts' })
    const row = deleteB.closest<HTMLElement>('li[role="treeitem"]')!
    await user.click(deleteB)
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(disk.files.has('lib/b.ts')).toBe(false))
  })

  it('a lost grant keeps saves in the app and shows Reconnect; Reconnect writes everything back', async () => {
    const user = userEvent.setup()
    const disk = sampleDisk()
    const store = mount()
    await openFolder(store, disk, 'README.md')

    disk.access = 'prompt' // the browser revoked or never kept write access
    typeAtStart(store, 'Offline. ')
    await act(() => getController(store).saveActive())

    expect(store.get(linkedFolderAtom)).toEqual({ name: 'proj', paused: true })
    expect(dec(disk.files.get('README.md'))).toBe('# hi\n') // disk untouched
    expect(await onAppDisk(store, 'README.md')).toBe('Offline. # hi\n') // app kept it

    const tree = await screen.findByRole('complementary', { name: 'File tree' })
    await user.click(within(tree).getByRole('button', { name: 'Reconnect' }))

    await waitFor(() => expect(dec(disk.files.get('README.md'))).toBe('Offline. # hi\n'))
    expect(dec(disk.files.get('src/a.ts'))).toBe('export const a = 1\n')
    expect(store.get(linkedFolderAtom)).toEqual({ name: 'proj', paused: false })
  })

  it('after a reload without the grant, the link is paused until Reconnect', async () => {
    const disk = sampleDisk()
    const first = mount()
    await openFolder(first, disk, 'README.md')
    cleanup()

    disk.access = 'prompt' // a new page load: the browser asks again
    const second = mount()
    await ready(second)
    await waitFor(() =>
      expect(second.get(linkedFolderAtom)).toEqual({ name: 'proj', paused: true }),
    )
    // The tree starts closed after a reload; Reconnect lives in it.
    second.set(sidebarOpenAtom, true)
    expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    expect(second.get(treeAtom).some((e) => e.path === 'src/a.ts')).toBe(true)
  })

  it('a file finishing its open does not take focus from a name being typed', async () => {
    const user = userEvent.setup()
    const disk = sampleDisk()
    const store = mount()
    await openFolder(store, disk, 'README.md')
    const tree = await screen.findByRole('complementary', { name: 'File tree' })

    fireEvent.contextMenu(tree)
    await user.click(await screen.findByRole('menuitem', { name: 'New folder' }))
    const field = within(tree).getByLabelText('New folder name')
    expect(field).toHaveFocus()

    await act(async () => {
      await getController(store).openFile('src/a.ts')
    })
    expect(field).toHaveFocus()
  })

  it('a blank workspace is not linked to any folder', async () => {
    const store = mount()
    await ready(store)
    expect(store.get(linkedFolderAtom)).toBeNull()
  })
})

/** Reads the app's own copy of a file, bypassing the controller. */
async function onAppDisk(store: ReturnType<typeof createStore>, path: string) {
  const fs = new IdbBackend(await openDB()).open(store.get(currentWorkspaceIdAtom)!)
  return fs.read(path)
}
