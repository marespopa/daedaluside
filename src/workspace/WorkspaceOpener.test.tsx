import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { branchReviewAtom, branchTabActiveAtom } from '../state/branchReviewAtoms'
import { paletteOpenAtom } from '../state/editorAtoms'
import {
  branchPrefetchCountAtom,
  branchPrefetchReadyAtom,
  gitBranchAtom,
} from '../state/gitAtoms'
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
  name?: string,
) {
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  const handle = disk.handle(name)
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

  it('opens the branch review from the home page', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    disk.setFile('README.md', new TextEncoder().encode('# r'))
    const store = mount()
    await openFolder(store, disk, 'README.md')
    await act(async () => {
      getController(store).showHome()
    })
    // A plain folder has no branch; pretend a repository was read.
    await act(async () => {
      store.set(gitBranchAtom, 'main')
      store.set(branchPrefetchReadyAtom, false)
    })
    const o = await opener()
    // No link while the review is still being prepared.
    expect(within(o).getByText('Checking changes…')).toBeInTheDocument()
    expect(within(o).queryByRole('button', { name: /Review branch changes/ })).toBeNull()
    await act(async () => {
      store.set(branchPrefetchCountAtom, 3)
      store.set(branchPrefetchReadyAtom, true)
    })
    expect(within(o).getByText('3 files changed')).toBeInTheDocument()
    await user.click(within(o).getByRole('button', { name: /Review branch changes/ }))
    expect(store.get(branchTabActiveAtom)).toBe(true)
    expect(store.get(branchReviewAtom)).not.toBeNull()
  })

  it('keeps the branch status in the footer while a file is open', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    disk.setFile('README.md', new TextEncoder().encode('# r'))
    const store = mount()
    await openFolder(store, disk, 'README.md')
    await act(async () => {
      store.set(gitBranchAtom, 'main')
      store.set(branchPrefetchCountAtom, 1)
      store.set(branchPrefetchReadyAtom, true)
    })
    await user.click(await screen.findByRole('button', { name: /Review branch changes/ }))
    expect(store.get(branchTabActiveAtom)).toBe(true)
  })

  it('shows no branch for a folder that is not a git repository', async () => {
    const disk = new MemDisk()
    disk.setFile('README.md', new TextEncoder().encode('# r'))
    const store = mount()
    await openFolder(store, disk, 'README.md')
    await act(async () => {
      getController(store).showHome()
    })
    const o = await opener()
    expect(within(o).queryByRole('button', { name: /Review branch changes/ })).toBeNull()
    expect(within(o).queryByRole('status', { name: 'Reading branch' })).toBeNull()
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

  it('pins workspaces and lists the others for one-tap switching', async () => {
    const user = userEvent.setup()
    const a = new MemDisk()
    a.setFile('a.txt', new TextEncoder().encode('a'))
    const b = new MemDisk()
    b.setFile('b.txt', new TextEncoder().encode('b'))
    const store = mount()
    await openFolder(store, a, 'a.txt')
    await act(async () => getController(store).showHome())
    const o = await opener()
    expect(
      await within(o).findByRole('button', { name: 'Open a Workspace' }),
    ).toBeInTheDocument()
    expect(within(o).queryByRole('button', { name: 'Switch Workspace' })).toBeNull()

    // Pin the first workspace, then open a second one.
    const pin = await within(o).findByRole('button', { name: 'Pin workspace' })
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    await user.click(pin)
    await waitFor(() => expect(pin).toHaveAttribute('aria-pressed', 'true'))
    await openFolder(store, b, 'b.txt', 'second')
    await act(async () => getController(store).showHome())

    const home = await opener()
    expect(
      await within(home).findByRole('button', { name: 'Switch Workspace' }),
    ).toBeInTheDocument()
    const pinned = await within(home).findByRole('list', { name: 'Pinned workspaces' })
    await user.click(within(pinned).getAllByRole('button')[0]!)
    await waitFor(() =>
      expect(store.get(treeAtom).some((e) => e.path === 'a.txt')).toBe(true),
    )
  })

  it('Switch Workspace opens the palette on the workspace commands', async () => {
    const user = userEvent.setup()
    const a = new MemDisk()
    a.setFile('a.txt', new TextEncoder().encode('a'))
    const b = new MemDisk()
    b.setFile('b.txt', new TextEncoder().encode('b'))
    const store = mount()
    await openFolder(store, a, 'a.txt')
    await openFolder(store, b, 'b.txt', 'second')
    await act(async () => getController(store).showHome())
    const o = await opener()
    await user.click(await within(o).findByRole('button', { name: 'Switch Workspace' }))
    expect(store.get(paletteOpenAtom)).toBe(true)
  })
})
