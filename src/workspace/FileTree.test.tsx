import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { vi } from 'vitest'
import {
  activePathAtom,
  linkedFolderAtom,
  openBuffersAtom,
  sidebarOpenAtom,
  treeAtom,
  treeProgressAtom,
  treeStatusAtom,
  workspaceStatusAtom,
  type TreeStatus,
} from '../state/workspaceAtoms'
import FileTree from './FileTree'
import { getController } from './controller'
import { MemDisk } from './testing/memoryDisk'
import { ROW_HEIGHT } from './treeRows'
import type { Entry } from './types'

const flatFiles = (n: number): Entry[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `f${i}.ts`,
    path: `f${i}.ts`,
    kind: 'file' as const,
    size: 1,
  }))

function mountTree(entries: Entry[]) {
  const store = createStore()
  store.set(sidebarOpenAtom, true)
  store.set(workspaceStatusAtom, { state: 'ready' })
  store.set(treeStatusAtom, { state: 'ready' })
  store.set(treeAtom, entries)
  render(
    <Provider store={store}>
      <FileTree />
    </Provider>,
  )
  return store
}

const rowButtons = () => document.querySelectorAll<HTMLElement>('[data-tree-row]')
const scrollerOf = () => screen.getByRole('tree').parentElement!

describe('file tree virtualization', () => {
  it('renders only the rows near the viewport, not the whole folder', () => {
    mountTree(flatFiles(20_000))
    expect(rowButtons().length).toBeGreaterThan(0)
    expect(rowButtons().length).toBeLessThan(60)
    // The list keeps the full height so the scrollbar reflects every row.
    expect(screen.getByRole('tree').style.height).toBe(`${20_000 * ROW_HEIGHT}px`)
  })

  it('renders the rows at the new position after scrolling', () => {
    mountTree(flatFiles(20_000))
    const scroller = scrollerOf()
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      value: ROW_HEIGHT * 15_000,
    })
    fireEvent.scroll(scroller)
    expect(screen.getByRole('button', { name: 'f15000.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'f0.ts' })).toBeNull()
    expect(rowButtons().length).toBeLessThan(60)
  })

  it('positions each row by its index and reports set size for assistive tech', () => {
    mountTree(flatFiles(200))
    const item = screen.getByRole('button', { name: 'f3.ts' }).closest('li')!
    expect(item.style.top).toBe(`${3 * ROW_HEIGHT}px`)
    expect(item).toHaveAttribute('aria-setsize', '200')
    expect(item).toHaveAttribute('aria-posinset', '4')
    expect(item).toHaveAttribute('aria-level', '1')
  })

  it('moves focus with the arrow keys past the rendered window', async () => {
    const user = userEvent.setup()
    mountTree(flatFiles(300))
    await user.click(screen.getByRole('button', { name: 'f0.ts' }))
    for (let i = 0; i < 60; i++) await user.keyboard('{ArrowDown}')

    const focused = document.activeElement as HTMLElement
    expect(focused.dataset.rowKey).toBe('f60.ts')
    expect(within(scrollerOf()).getByRole('button', { name: 'f60.ts' })).toBe(focused)
    // Only the focused row is in the tab order.
    expect(
      [...rowButtons()].filter((el) => el.tabIndex === 0).map((el) => el.dataset.rowKey),
    ).toEqual(['f60.ts'])
  }, 15_000) // user-event is slow when the whole suite runs in parallel

  it('Home and End jump to the first and last rows', async () => {
    const user = userEvent.setup()
    mountTree(flatFiles(300))
    await user.click(screen.getByRole('button', { name: 'f0.ts' }))
    await user.keyboard('{End}')
    expect((document.activeElement as HTMLElement).dataset.rowKey).toBe('f299.ts')
    expect(screen.getByRole('button', { name: 'f299.ts' })).toBeInTheDocument()
    await user.keyboard('{Home}')
    expect((document.activeElement as HTMLElement).dataset.rowKey).toBe('f0.ts')
  }, 15_000) // user-event is slow when the whole suite runs in parallel

  it('keeps the active file reachable by scrolling it into view', () => {
    const store = createStore()
    store.set(sidebarOpenAtom, true)
    store.set(workspaceStatusAtom, { state: 'ready' })
    store.set(treeStatusAtom, { state: 'ready' })
    store.set(treeAtom, flatFiles(5_000))
    store.set(activePathAtom, 'f4000.ts')
    render(
      <Provider store={store}>
        <FileTree />
      </Provider>,
    )
    expect(screen.getByRole('button', { name: 'f4000.ts' })).toBeInTheDocument()
    expect(rowButtons().length).toBeLessThan(60)
  })
})

describe('file tree folders and menu', () => {
  const nested: Entry[] = [
    { name: 'docs', path: 'docs', kind: 'dir' },
    { name: 'a.md', path: 'docs/a.md', kind: 'file', size: 1 },
    { name: 'main.ts', path: 'main.ts', kind: 'file', size: 1 },
  ]

  it('expands and collapses folders with l and h, without toolbar chrome', () => {
    mountTree(nested)
    expect(screen.queryByRole('button', { name: 'a.md' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand all folders' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show file tree' })).toBeNull()

    const docs = screen.getByRole('button', { name: 'docs' })
    docs.focus()
    fireEvent.keyDown(docs, { key: 'l' })
    expect(screen.getByRole('button', { name: 'a.md' })).toBeInTheDocument()

    fireEvent.keyDown(docs, { key: 'h' })
    expect(screen.queryByRole('button', { name: 'a.md' })).toBeNull()
  })

  it('moves with j, k, gg and G, and jumps to the parent with -', async () => {
    const user = userEvent.setup()
    mountTree(nested)
    const docs = screen.getByRole('button', { name: 'docs' })
    docs.focus()
    await user.keyboard('l')

    const file = screen.getByRole('button', { name: 'a.md' })
    file.focus()
    await user.keyboard('-')
    expect(document.activeElement).toBe(docs)

    await user.keyboard('j')
    expect(document.activeElement).toBe(file)
    await user.keyboard('k')
    expect(document.activeElement).toBe(docs)

    await user.keyboard('G')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'main.ts' }))
    await user.keyboard('gg')
    expect(document.activeElement).toBe(docs)
  })

  it('opens a file with Enter or l', async () => {
    const user = userEvent.setup()
    const store = mountTree(nested)
    const open = vi.spyOn(getController(store), 'openFile').mockResolvedValue()
    const main = screen.getByRole('button', { name: 'main.ts' })
    main.focus()
    await user.keyboard('{Enter}l')
    expect(open).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledWith('main.ts')
  })

  it('uses a, A, r and d for inline file operations', async () => {
    const user = userEvent.setup()
    mountTree(nested)

    const docs = () => screen.getByRole('button', { name: 'docs' })
    docs().focus()
    await user.keyboard('a')
    expect(screen.getByRole('textbox', { name: 'New file name' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    docs().focus()
    await user.keyboard('A')
    expect(screen.getByRole('textbox', { name: 'New folder name' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    docs().focus()
    await user.keyboard('r')
    expect(screen.getByRole('textbox', { name: 'Rename docs' })).toHaveValue('docs')
    await user.keyboard('{Escape}')

    docs().focus()
    await user.keyboard('d')
    expect(screen.getByText('Delete docs?')).toBeInTheDocument()
  })

  it('copies paths with y and Y, refreshes with Ctrl-R, and closes with q', async () => {
    const user = userEvent.setup()
    const store = mountTree(nested)
    const controller = getController(store)
    const relative = vi.spyOn(controller, 'copyPath').mockResolvedValue()
    const absolute = vi.spyOn(controller, 'copyAbsolutePath').mockResolvedValue()
    const refresh = vi.spyOn(controller, 'refreshWorkspace').mockResolvedValue()
    const main = screen.getByRole('button', { name: 'main.ts' })
    main.focus()

    await user.keyboard('yY')
    await user.keyboard('{Control>}r{/Control}')
    expect(relative).toHaveBeenCalledWith('main.ts')
    expect(absolute).toHaveBeenCalledWith('main.ts')
    expect(refresh).toHaveBeenCalledOnce()

    await user.keyboard('q')
    expect(store.get(sidebarOpenAtom)).toBe(false)
  })

  it('opens the menu from a row, and from empty space as the root', async () => {
    const user = userEvent.setup()
    mountTree(nested)
    const tree = screen.getByRole('complementary', { name: 'File tree' })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'main.ts' }))
    const menu = screen.getByRole('menu', { name: 'Tree actions' })
    expect(within(menu).getByRole('menuitem', { name: 'New file' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(tree)
    const rootMenu = screen.getByRole('menu', { name: 'Tree actions' })
    expect(rootMenu).toBeInTheDocument()
    expect(within(rootMenu).queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    expect(within(rootMenu).queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })

  it('uses the existing rename input and delete confirmation from the row menu', async () => {
    const user = userEvent.setup()
    mountTree(nested)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'docs' }))
    let menu = screen.getByRole('menu', { name: 'Tree actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    expect(screen.getByRole('textbox', { name: 'Rename docs' })).toHaveValue('docs')
    await user.keyboard('{Escape}')

    fireEvent.contextMenu(screen.getByRole('button', { name: 'main.ts' }))
    menu = screen.getByRole('menu', { name: 'Tree actions' })
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByText('Delete main.ts?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'main.ts' })).toBeInTheDocument()
  })

  it('opens the menu from the keyboard with Shift+F10 on a focused row', () => {
    mountTree(nested)
    fireEvent.keyDown(screen.getByRole('button', { name: 'docs' }), {
      key: 'F10',
      shiftKey: true,
    })
    expect(screen.getByRole('menu', { name: 'Tree actions' })).toBeInTheDocument()
  })

  it('keeps the native menu on the inline name field', async () => {
    const user = userEvent.setup()
    mountTree(nested)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'main.ts' }))
    await user.click(screen.getByRole('menuitem', { name: 'New folder' }))
    const field = screen.getByLabelText('New folder name')
    fireEvent.contextMenu(field)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('quick finder', () => {
  const nested: Entry[] = [
    { name: 'docs', path: 'docs', kind: 'dir' },
    { name: 'a.md', path: 'docs/a.md', kind: 'file', size: 1 },
    { name: 'main.ts', path: 'main.ts', kind: 'file', size: 1 },
  ]

  it('lists matching files in place of the tree, and Escape brings the tree back', async () => {
    const user = userEvent.setup()
    mountTree(nested)
    const input = screen.getByRole('textbox', { name: 'Find a file' })

    await user.type(input, 'docs')
    const results = screen.getByRole('listbox', { name: 'Matching files' })
    expect(within(results).getByRole('option', { name: /a\.md/ })).toBeInTheDocument()
    expect(within(results).getAllByRole('option')).toHaveLength(1)

    await user.type(input, 'zzz')
    expect(screen.getByText('No matching files')).toBeInTheDocument()

    await user.keyboard('{Escape}') // the first Escape clears the search
    expect(input).toHaveValue('')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'docs' })).toBeInTheDocument()
  })
})

describe('file tree states', () => {
  /** Mounts the sidebar with a given tree status, like the controller would leave it. */
  function mountState(
    status: TreeStatus,
    entries: Entry[] = [],
    link: { name: string; paused: boolean } | null = null,
  ) {
    const store = createStore()
    store.set(sidebarOpenAtom, true)
    store.set(workspaceStatusAtom, { state: 'ready' })
    store.set(treeStatusAtom, status)
    store.set(treeAtom, entries)
    store.set(linkedFolderAtom, link)
    render(
      <Provider store={store}>
        <FileTree />
      </Provider>,
    )
    return store
  }

  it('asks for a folder when there is none, instead of an empty workspace', async () => {
    const user = userEvent.setup()
    const handle = new MemDisk().handle()
    vi.stubGlobal('showDirectoryPicker', async () => handle)
    const store = mountState({ state: 'no-folder' })
    const open = vi.spyOn(getController(store), 'importFolderHandle').mockResolvedValue()

    expect(screen.getByText('No folder open')).toBeInTheDocument()
    expect(screen.queryByText(/folder is empty|Empty folder/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Find a file' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(open).toHaveBeenCalledWith(handle)
    vi.unstubAllGlobals()
  })

  it('shows a loading message, not an empty folder, while the folder is read', () => {
    mountState({ state: 'loading' })
    const tree = screen.getByRole('complementary', { name: 'File tree' })
    expect(tree).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText(/folder is empty|Empty folder/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Find a file' })).toBeDisabled()
  })

  it('keeps the current rows visible with a loading indicator during a refresh', () => {
    mountState({ state: 'loading' }, [
      { name: 'a.md', path: 'a.md', kind: 'file', size: 1 },
    ])
    expect(screen.getByRole('button', { name: 'a.md' })).toBeInTheDocument()
    expect(screen.getByText('Loading files…')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'File tree' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('shows a determinate bar and count when the total is known', () => {
    const store = mountState({ state: 'loading' })
    act(() => store.set(treeProgressAtom, { done: 120, total: 480 }))
    expect(screen.getByRole('status')).toHaveTextContent('Reading files… 120 / 480')
    expect(
      screen.getByTestId('tree-progress').querySelector('[data-progress]'),
    ).toHaveAttribute('data-progress', '25')
  })

  it('shows an indeterminate bar and file count when the total is unknown', () => {
    const store = mountState({ state: 'loading' })
    act(() => store.set(treeProgressAtom, { done: 120, total: null }))
    expect(screen.getByRole('status')).toHaveTextContent('Reading files… 120 files')
    expect(screen.getByTestId('tree-progress')).toBeInTheDocument()
    expect(document.querySelector('[data-progress]')).toBeNull()
  })

  it('hides the progress bar and status once the tree is ready', () => {
    const store = mountState({ state: 'loading' })
    act(() => store.set(treeProgressAtom, { done: 5, total: 10 }))
    act(() => {
      store.set(treeProgressAtom, null)
      store.set(treeStatusAtom, { state: 'ready' })
    })
    expect(screen.queryByTestId('tree-progress')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens files while the tree is still loading', async () => {
    const user = userEvent.setup()
    const store = mountState({ state: 'loading' }, [
      { name: 'a.md', path: 'a.md', kind: 'file', size: 1 },
    ])
    const open = vi.spyOn(getController(store), 'openFile').mockResolvedValue()
    await user.click(screen.getByRole('button', { name: 'a.md' }))
    expect(open).toHaveBeenCalledWith('a.md')
  })

  it('asks to reconnect when the folder is not granted, and Reconnect stays available', async () => {
    const user = userEvent.setup()
    const store = mountState({ state: 'permission' }, [], { name: 'proj', paused: true })
    const reconnect = vi
      .spyOn(getController(store), 'reconnectFolder')
      .mockResolvedValue()

    expect(
      screen.getByText('Reconnect to see the files in this folder.'),
    ).toBeInTheDocument()

    const button = screen.getByRole('button', { name: 'Reconnect' })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('shows the listing error and a Retry that refreshes the workspace', async () => {
    const user = userEvent.setup()
    const store = mountState({ state: 'error', message: 'the disk fell over' })
    const refresh = vi.spyOn(getController(store), 'refreshWorkspace').mockResolvedValue()

    expect(
      screen.getByText('Could not list this folder: the disk fell over'),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('the disk fell over')
    expect(screen.queryByRole('tree')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('says the folder is empty when connected and empty', () => {
    mountState({ state: 'ready' })
    expect(
      screen.getByText('This folder is empty. Create a file to start.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('No folder open')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Find a file' })).toBeEnabled()
  })
})

describe('minimal sidebar chrome', () => {
  const nested: Entry[] = [
    { name: 'src', path: 'src', kind: 'dir' },
    { name: 'a.ts', path: 'src/a.ts', kind: 'file', size: 1 },
  ]

  it('names the root in the header and closes from its button', async () => {
    const user = userEvent.setup()
    const store = mountTree(nested)
    store.set(linkedFolderAtom, { name: 'proj', paused: false, single: false })
    expect((await screen.findAllByText('proj')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Close file tree' }))
    expect(store.get(sidebarOpenAtom)).toBe(false)
  })

  it('collapses every folder from the header', async () => {
    const user = userEvent.setup()
    mountTree(nested)
    await user.click(screen.getByRole('button', { name: 'src' }))
    expect(rowButtons()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(rowButtons()).toHaveLength(1)
  })

  it('marks dirty files, and their collapsed folders, with a dot', async () => {
    const store = mountTree(nested)
    store.set(openBuffersAtom, [
      { path: 'src/a.ts', pinned: false, dirty: true, saveError: false },
    ])
    expect(await screen.findAllByRole('img', { name: 'Unsaved changes' })).toHaveLength(1)
    store.set(openBuffersAtom, [
      { path: 'src/a.ts', pinned: false, dirty: false, saveError: false },
    ])
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Unsaved changes' })).toBeNull(),
    )
  })
})
