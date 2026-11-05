import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { paletteOpenAtom } from '../state/editorAtoms'
import { activePathAtom, treeAtom, workspaceStatusAtom } from '../state/workspaceAtoms'
import { getController } from './controller'
import { MemDisk } from './testing/memoryDisk'

function mount() {
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  return store
}

/** Opens a MemDisk folder as the current workspace, optionally waiting for a file. */
async function openFolder(
  store: ReturnType<typeof createStore>,
  disk: MemDisk,
  firstFile?: string,
) {
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  const handle = disk.handle()
  await act(async () => {
    await getController(store).importFolderHandle(handle as never)
  })
  if (firstFile) {
    await waitFor(() => expect(store.get(activePathAtom)).toBe(firstFile))
  }
}

const opener = () => screen.findByRole('region', { name: 'Workspace opener' })

describe('workspace opener', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('offers Open folder, not file search, when no workspace is open', async () => {
    const store = mount()
    await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
    const o = await opener()

    expect(within(o).getByText('Open a folder to start editing.')).toBeInTheDocument()
    expect(within(o).getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
    expect(within(o).queryByRole('textbox', { name: 'Search files' })).toBeNull()
    // The blank page embeds no finder of its own; searching belongs to the palette.
    expect(within(o).queryByRole('textbox')).toBeNull()
  })

  it('a key typed with no workspace open starts no untitled file', async () => {
    const user = userEvent.setup()
    const store = mount()
    await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))

    await user.keyboard('hi')

    expect(store.get(activePathAtom)).toBeNull()
    expect(store.get(treeAtom).some((e) => e.kind === 'file')).toBe(false)
  })

  it('Search files opens the palette, and Enter opens the chosen file', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    disk.setFile('src/app.ts', new TextEncoder().encode('export {}'))
    disk.setFile('README.md', new TextEncoder().encode('# r'))
    const store = mount()
    await openFolder(store, disk, 'README.md')
    await act(async () => {
      getController(store).showHome()
    })
    expect(store.get(activePathAtom)).toBeNull()

    const o = await opener()
    expect(await within(o).findByText(/2 files$/)).toBeInTheDocument()
    expect(within(o).queryByRole('button', { name: 'Open folder' })).toBeNull()
    expect(within(o).queryByRole('button', { name: 'Open file' })).toBeNull()
    expect(within(o).getByRole('button', { name: /Search Files/ })).toBeEnabled()

    await user.click(within(o).getByRole('button', { name: /Search Files/ }))

    expect(store.get(paletteOpenAtom)).toBe(true)
    const input = (await screen.findByRole('combobox')) as HTMLInputElement
    expect(input).toHaveValue('')
    await user.type(input, 'app')
    // Searching reads the whole tree first.
    expect(await screen.findByRole('option', { name: 'src/app.ts' })).toBeInTheDocument()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(store.get(activePathAtom)).toBe('src/app.ts'))
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Workspace opener' })).toBeNull()
  })
})
