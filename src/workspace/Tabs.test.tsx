import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { editorHandleAtom } from '../state/editorAtoms'
import { activePathAtom, treeAtom, workspaceStatusAtom } from '../state/workspaceAtoms'
import { getController } from './controller'
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

type Store = ReturnType<typeof createStore>

const ctl = (store: Store) => getController(store)

const tabEl = (path: string) =>
  screen.getAllByRole('tab').find((el) => el.getAttribute('title') === path)!

const tabPaths = () => screen.getAllByRole('tab').map((el) => el.getAttribute('title'))

/** Testing Library has no auxClick helper; dispatch the DOM event directly. */
const middleClick = (el: HTMLElement) =>
  fireEvent(
    el,
    new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
  )

const menu = () => screen.findByRole('menu', { name: 'Tab actions' })

async function openFolder(store: Store, disk: MemDisk, firstFile?: string) {
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

/** Opens a folder and creates `scratch.ts` when it is missing. */
async function scratchTab() {
  const store = lastStore!
  const disk = lastDisk ?? new MemDisk()
  if (!lastDisk) await openFolder(store, disk)
  if (!store.get(treeAtom).some((e) => e.path === 'scratch.ts')) {
    await act(() => ctl(store).createFile('scratch.ts'))
  }
  return screen.findByRole('tab', { name: /^scratch/ })
}

async function openTabs(store: Store, ...names: string[]) {
  for (const name of names) await act(() => ctl(store).createFile(name))
}

/** Writes into the active editor, making it dirty. */
function type(store: Store, text: string) {
  const v = store.get(editorHandleAtom)!.view
  act(() => v.dispatch({ changes: { from: v.state.doc.length, insert: text } }))
}

/** Reads straight from the linked folder, bypassing the app. */
async function onDisk(store: Store, path: string) {
  const fs = (ctl(store) as unknown as { fs: WorkspaceFS }).fs
  return fs.read(path)
}

describe('tab strip', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    lastDisk = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('middle-click closes a tab', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')
    const tab = await screen.findByRole('tab', { name: /^a\.ts/ })
    fireEvent.mouseDown(tab, { button: 1 })
    middleClick(tab)
    await waitFor(() => expect(tabPaths()).toEqual(['scratch.ts']))
  })

  it('closes a tab from its hover close icon', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')

    fireEvent.click(screen.getByRole('button', { name: 'Close a.ts' }))

    await waitFor(() => expect(tabPaths()).toEqual(['scratch.ts']))
  })

  it('the context menu pins a tab, and Close Others keeps pinned tabs', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts', 'b.ts')

    fireEvent.contextMenu(tabEl('a.ts'), { clientX: 10, clientY: 10 })
    const contextMenu = await menu()
    expect(contextMenu).toHaveClass('glass', 'border-line', 'shadow-lg')
    await user.click(within(contextMenu).getByRole('menuitem', { name: 'Pin Tab' }))
    // Pinned tabs move to the start of the strip and show as an icon named by the file.
    await waitFor(() => expect(tabPaths()).toEqual(['a.ts', 'scratch.ts', 'b.ts']))
    expect(screen.getByRole('tab', { name: 'a.ts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close a.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(tabEl('b.ts'))
    await user.click(within(await menu()).getByRole('menuitem', { name: 'Close Others' }))
    await waitFor(() => expect(tabPaths()).toEqual(['a.ts', 'b.ts']))
  })

  it('Escape dismisses the tab menu and returns focus to the tab', async () => {
    const user = userEvent.setup()
    mount()
    const scratch = await scratchTab()
    fireEvent.contextMenu(scratch)
    await menu()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(scratch)
  })

  it('arrow keys move focus between tabs, and Mod-Alt-W closes the active one', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')

    tabEl('scratch.ts').focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tabEl('a.ts'))

    await user.keyboard('{Control>}{Alt>}w{/Alt}{/Control}')
    await waitFor(() => expect(tabPaths()).toEqual(['scratch.ts']))
    expect(a.store.get(activePathAtom)).toBe('scratch.ts')
  })

  it('keeps the dirty dot visible until Ctrl+S saves the active file', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')
    type(a.store, 'draft')

    const dirty = screen.getByRole('img', { name: 'unsaved' })
    expect(dirty).toHaveClass('size-1.5', 'rounded-full', 'bg-accent')

    await user.keyboard('{Control>}s{/Control}')

    await waitFor(async () => {
      expect(await onDisk(a.store, 'a.ts')).toBe('draft')
      expect(screen.queryByRole('img', { name: 'unsaved' })).toBeNull()
    })
  })

  it('saves the active dirty file from the header button', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')

    // Autosave covers the clean case, so the button only appears once there is something to save.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

    type(a.store, 'draft')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeEnabled()

    const fs = (ctl(a.store) as unknown as { fs: WorkspaceFS }).fs
    const originalWrite = fs.write.bind(fs)
    let finishWrite!: () => void
    vi.spyOn(fs, 'write').mockImplementation(async (path, text) => {
      await new Promise<void>((resolve) => {
        finishWrite = resolve
      })
      await originalWrite(path, text)
    })
    await user.click(save)

    const saving = screen.getByRole('button', { name: 'Saving' })
    expect(saving).toBeDisabled()
    expect(saving.querySelector('span')).toHaveClass('animate-spin')
    await act(async () => finishWrite())

    await waitFor(async () => {
      expect(await onDisk(a.store, 'a.ts')).toBe('draft')
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    })
  })

  it('shows a failed-save state on the header button and allows retry', async () => {
    const user = userEvent.setup()
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')
    type(a.store, 'draft')

    const fs = (ctl(a.store) as unknown as { fs: WorkspaceFS }).fs
    let failWrite!: (error: Error) => void
    vi.spyOn(fs, 'write').mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          failWrite = reject
        }),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const saving = screen.getByRole('button', { name: 'Saving' })
    expect(saving).toBeDisabled()
    expect(saving.querySelector('span')).toHaveClass('animate-spin')
    await act(async () => failWrite(new Error('disk full')))

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    const save = screen.getByRole('button', { name: 'Save failed' })
    expect(save).toBeEnabled()
    expect(save).toHaveClass('text-diff-remove-fg')
    expect(save).toHaveAttribute('title', 'Save failed — retry (Ctrl+S)')
  })

  it('dragging a tab onto the right half of another moves it there', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts', 'b.ts')

    // jsdom has no layout: give each tab a 100 px slot.
    document.querySelectorAll<HTMLElement>('[data-tab]').forEach((el, i) => {
      el.getBoundingClientRect = () =>
        ({
          left: i * 100,
          right: i * 100 + 100,
          top: 0,
          bottom: 40,
          width: 100,
          height: 40,
          x: i * 100,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect
    })

    const dt = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    fireEvent.dragStart(tabEl('scratch.ts'), { dataTransfer: dt })
    const strip = screen.getByRole('tablist', { name: 'Open files' })
    fireEvent.dragOver(strip, { dataTransfer: dt, clientX: 280 })
    fireEvent.drop(strip, { dataTransfer: dt, clientX: 280 })
    fireEvent.dragEnd(tabEl('scratch.ts'), { dataTransfer: dt })

    await waitFor(() => expect(tabPaths()).toEqual(['a.ts', 'b.ts', 'scratch.ts']))
    expect(a.store.get(activePathAtom)).toBe('b.ts') // the active tab is unchanged
  })

  it('closing a dirty tab saves it first', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')
    type(a.store, 'draft')
    middleClick(tabEl('a.ts'))
    await waitFor(() => expect(tabPaths()).toEqual(['scratch.ts']))
    expect(await onDisk(a.store, 'a.ts')).toBe('draft')
  })

  it('a tab whose save fails stays open with its edits', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')
    type(a.store, 'draft')

    const fs = (ctl(a.store) as unknown as { fs: WorkspaceFS }).fs
    vi.spyOn(fs, 'write').mockRejectedValue(new Error('disk full'))
    middleClick(tabEl('a.ts'))

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(tabPaths()).toContain('a.ts')
    expect(screen.getByRole('img', { name: 'save failed' })).toBeInTheDocument()
  })

  it('pinned tabs survive a reload', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts')
    act(() => ctl(a.store).togglePin('a.ts'))
    // The session is saved 500 ms after a change.
    ctl(a.store).flushOnHide()
    await new Promise((r) => setTimeout(r, 700))
    a.unmount()

    const b = mount()
    await openFolder(b.store, disk)
    await screen.findByRole('tab', { name: 'a.ts' })
    expect(tabPaths()).toEqual(['a.ts', 'scratch.ts'])
  })

  it('shows quiet pill tabs in a scrollable strip, with the close icon on hover', async () => {
    const disk = new MemDisk()
    const a = mount()
    await openFolder(a.store, disk)
    await scratchTab()
    await openTabs(a.store, 'a.ts', 'b.ts')

    const strip = screen.getByRole('tablist', { name: 'Open files' })
    expect(strip).toHaveClass('overflow-x-auto', '[scrollbar-width:none]')
    expect(strip.parentElement).toHaveClass('font-sans', 'text-sm')
    // The active tab is a surface pill; the others are muted text that brightens on hover.
    expect(tabEl('b.ts').parentElement).toHaveClass('bg-surface')
    expect(tabEl('a.ts').parentElement).not.toHaveClass('bg-surface')
    expect(tabEl('a.ts')).toHaveClass('text-muted')
    expect(within(strip).getAllByRole('button', { name: /^Close / })).toHaveLength(3)
    expect(within(strip).getByRole('button', { name: 'Close a.ts' })).toHaveClass(
      'opacity-0',
      'group-hover:opacity-100',
    )
  })
})
