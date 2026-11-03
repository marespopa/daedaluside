import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { editorHandleAtom } from '../state/editorAtoms'
import { activePathAtom, currentWorkspaceIdAtom } from '../state/workspaceAtoms'
import { getController } from './controller'
import { openDB } from './db'
import { IdbBackend } from './fallback-idb'
import type { WorkspaceFS } from './types'

function mount() {
  const store = createStore()
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

async function openTabs(store: Store, ...names: string[]) {
  for (const name of names) await act(() => ctl(store).createFile(name))
}

/** Writes into the active editor, making it dirty. */
function type(store: Store, text: string) {
  const v = store.get(editorHandleAtom)!.view
  act(() => v.dispatch({ changes: { from: v.state.doc.length, insert: text } }))
}

/** Reads straight from storage, bypassing the app. */
async function onDisk(store: Store, path: string) {
  const fs = new IdbBackend(await openDB()).open(store.get(currentWorkspaceIdAtom)!)
  return fs.read(path)
}

describe('tab strip', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('middle-click closes a tab', async () => {
    const a = mount()
    await screen.findByRole('tab', { name: /^scratch/ })
    await openTabs(a.store, 'a.ts')
    const tab = await screen.findByRole('tab', { name: /^a\.ts/ })
    fireEvent.mouseDown(tab, { button: 1 })
    middleClick(tab)
    await waitFor(() => expect(tabPaths()).toEqual(['scratch.ts']))
  })

  it('the context menu pins a tab, and Close Others keeps pinned tabs', async () => {
    const user = userEvent.setup()
    const a = mount()
    await screen.findByRole('tab', { name: /^scratch/ })
    await openTabs(a.store, 'a.ts', 'b.ts')

    fireEvent.contextMenu(tabEl('a.ts'), { clientX: 10, clientY: 10 })
    await user.click(within(await menu()).getByRole('menuitem', { name: 'Pin Tab' }))
    // Pinned tabs move to the start of the strip and show as an icon named by the file.
    await waitFor(() => expect(tabPaths()).toEqual(['a.ts', 'scratch.ts', 'b.ts']))
    expect(screen.getByRole('tab', { name: 'a.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(tabEl('b.ts'))
    await user.click(within(await menu()).getByRole('menuitem', { name: 'Close Others' }))
    await waitFor(() => expect(tabPaths()).toEqual(['a.ts', 'b.ts']))
  })

  it('Escape dismisses the tab menu and returns focus to the tab', async () => {
    const user = userEvent.setup()
    mount()
    const scratch = await screen.findByRole('tab', { name: /^scratch/ })
    fireEvent.contextMenu(scratch)
    await menu()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(scratch)
  })

  it('arrow keys move focus between tabs, and Mod-Alt-W closes the active one', async () => {
    const user = userEvent.setup()
    const a = mount()
    await screen.findByRole('tab', { name: /^scratch/ })
    await openTabs(a.store, 'a.ts')

    tabEl('scratch.ts').focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tabEl('a.ts'))

    await user.keyboard('{Control>}{Alt>}w{/Alt}{/Control}')
    await waitFor(() => expect(tabPaths()).toEqual(['scratch.ts']))
    expect(a.store.get(activePathAtom)).toBe('scratch.ts')
  })

  it('dragging a tab onto the right half of another moves it there', async () => {
    const a = mount()
    await screen.findByRole('tab', { name: /^scratch/ })
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
    const a = mount()
    await screen.findByRole('tab', { name: /^scratch/ })
    await openTabs(a.store, 'a.ts')
    type(a.store, 'draft')
    middleClick(tabEl('a.ts'))
    await waitFor(() => expect(tabPaths()).toEqual(['scratch.ts']))
    expect(await onDisk(a.store, 'a.ts')).toBe('draft')
  })

  it('a tab whose save fails stays open with its edits', async () => {
    const a = mount()
    await screen.findByRole('tab', { name: /^scratch/ })
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
    const a = mount()
    await screen.findByRole('tab', { name: /^scratch/ })
    await openTabs(a.store, 'a.ts')
    act(() => ctl(a.store).togglePin('a.ts'))
    // The session is saved 500 ms after a change.
    await new Promise((r) => setTimeout(r, 700))
    a.unmount()

    mount()
    await screen.findByRole('tab', { name: 'a.ts' })
    expect(tabPaths()).toEqual(['a.ts', 'scratch.ts'])
  })
})
