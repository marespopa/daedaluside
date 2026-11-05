import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { editorHandleAtom } from '../state/editorAtoms'
import { activePathAtom, workspaceStatusAtom } from '../state/workspaceAtoms'
import { getController } from '../workspace/controller'
import { MemDisk } from '../workspace/testing/memoryDisk'
import type { WorkspaceFS } from '../workspace/types'

type Store = ReturnType<typeof createStore>

const enc = (s: string) => new TextEncoder().encode(s)

const A = 'export function run() {}\n'
const B = "import { run } from './a'\nconst x = run()\n"

async function setup(extra: Record<string, string> = {}) {
  const disk = new MemDisk()
  disk.files.set('a.ts', enc(A))
  disk.files.set('b.ts', enc(B))
  for (const [p, t] of Object.entries(extra)) disk.files.set(p, enc(t))
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  await act(async () => {
    await getController(store).importFolderHandle(disk.handle() as never)
  })
  await act(() => getController(store).openFile('b.ts'))
  await waitFor(() => expect(store.get(activePathAtom)).toBe('b.ts'))
  return { store, disk }
}

/** Puts the caret inside `word` on the line that starts with `lineStart`. */
function caretIn(store: Store, lineStart: string, word: string) {
  const view = store.get(editorHandleAtom)!.view
  const line = [...Array(view.state.doc.lines)]
    .map((_, i) => view.state.doc.line(i + 1))
    .find((l) => l.text.startsWith(lineStart))!
  const at = line.from + line.text.indexOf(word, lineStart.length > 0 ? 0 : 0) + 1
  act(() => {
    view.dispatch({ selection: { anchor: at } })
    view.focus()
  })
  return view
}

const diskText = (store: Store, path: string) =>
  (getController(store) as unknown as { fs: WorkspaceFS }).fs.read(path)

describe('symbol overlays', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('F12 on a call site opens the definition', async () => {
    const { store } = await setup()
    caretIn(store, 'const x', 'run')
    await userEvent.setup().keyboard('{F12}')
    await waitFor(() => expect(store.get(activePathAtom)).toBe('a.ts'))
  })

  it('F12 shows a message when nothing declares the symbol', async () => {
    const { store } = await setup({ 'c.ts': 'ghost()\n' })
    await act(() => getController(store).openFile('c.ts'))
    caretIn(store, 'ghost', 'ghost')
    await userEvent.setup().keyboard('{F12}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No definition found for ghost',
    )
    expect(store.get(activePathAtom)).toBe('c.ts')
  })

  it('Shift+F12 lists references; picking one opens it, Esc returns focus', async () => {
    const { store } = await setup()
    const view = caretIn(store, 'const x', 'run')
    const user = userEvent.setup()
    await user.keyboard('{Shift>}{F12}{/Shift}')
    const panel = await screen.findByRole('dialog', { name: 'References to run' })
    const rows = within(panel).getAllByRole('button')
    expect(rows.length).toBeGreaterThanOrEqual(3)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(view.hasFocus).toBe(true)

    await user.keyboard('{Shift>}{F12}{/Shift}')
    const again = await screen.findByRole('dialog', { name: 'References to run' })
    await user.click(
      within(again)
        .getAllByRole('button')
        .find((b) => b.textContent?.startsWith('a.ts:1'))!,
    )
    await waitFor(() => expect(store.get(activePathAtom)).toBe('a.ts'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Alt+F12 peeks the definition without switching tabs or moving the caret', async () => {
    const { store } = await setup()
    const view = caretIn(store, 'const x', 'run')
    const before = view.state.selection.main.head
    const user = userEvent.setup()
    await user.keyboard('{Alt>}{F12}{/Alt}')
    const peek = await screen.findByRole('dialog', { name: 'Definition of run' })
    expect(peek).toHaveTextContent('export function run() {}')
    expect(peek).toHaveTextContent('a.ts:1')
    expect(store.get(activePathAtom)).toBe('b.ts')
    expect(view.state.selection.main.head).toBe(before)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(view.hasFocus).toBe(true)
  })

  it('right-click opens the menu; Esc closes it and refocuses the editor', async () => {
    const { store } = await setup()
    const view = caretIn(store, 'const x', 'run')
    view.posAtCoords = () => view.state.doc.line(2).from + 11
    fireEvent.contextMenu(view.contentDOM, { clientX: 5, clientY: 5 })
    const menu = await screen.findByRole('menu', { name: 'Editor' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveTextContent('Go to Definition')
    expect(items[0]).toHaveTextContent('F12')
    expect(within(menu).getByRole('menuitem', { name: /Call Hierarchy/ })).toBeDisabled()
    await userEvent.setup().keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(view.hasFocus).toBe(true)
  })

  it('choosing Go to Definition from the menu navigates', async () => {
    const { store } = await setup()
    const view = caretIn(store, 'const x', 'run')
    view.posAtCoords = () => view.state.doc.line(2).from + 11
    fireEvent.contextMenu(view.contentDOM, { clientX: 5, clientY: 5 })
    const menu = await screen.findByRole('menu', { name: 'Editor' })
    await userEvent
      .setup()
      .click(within(menu).getByRole('menuitem', { name: /Go to Definition/ }))
    await waitFor(() => expect(store.get(activePathAtom)).toBe('a.ts'))
  })

  it('F2 renames across files after a preview, and files can be deselected', async () => {
    const { store } = await setup({ 'c.ts': 'run()\n' })
    caretIn(store, 'const x', 'run')
    const user = userEvent.setup()
    await user.keyboard('{F2}')
    const input = await screen.findByLabelText('Rename run to')
    await user.clear(input)
    await user.type(input, 'go')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    const preview = await screen.findByRole('dialog', { name: 'Rename run to go' })
    expect(within(preview).getAllByRole('checkbox')).toHaveLength(3)
    await user.click(within(preview).getByRole('checkbox', { name: /c\.ts/ }))
    await user.click(within(preview).getByRole('button', { name: 'Rename in 2 files' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Renamed in 2 files')
    await act(() => getController(store).flushAll())
    expect(await diskText(store, 'a.ts')).toBe('export function go() {}\n')
    expect(await diskText(store, 'b.ts')).toBe(
      "import { go } from './a'\nconst x = go()\n",
    )
    expect(await diskText(store, 'c.ts')).toBe('run()\n')
  })

  it('rejects invalid names and the unchanged name', async () => {
    const { store } = await setup()
    caretIn(store, 'const x', 'run')
    const user = userEvent.setup()
    await user.keyboard('{F2}')
    const input = await screen.findByLabelText('Rename run to')
    const preview = screen.getByRole('button', { name: 'Preview' })
    expect(preview).toBeDisabled()
    await user.clear(input)
    await user.type(input, '1bad')
    expect(preview).toBeDisabled()
    expect(screen.getByText('Not a valid identifier')).toBeInTheDocument()
  })

  it('renames whole words only, leaving longer identifiers alone', async () => {
    const { store } = await setup({ 'c.ts': 'const runner = run\n' })
    caretIn(store, 'const x', 'run')
    const user = userEvent.setup()
    await user.keyboard('{F2}')
    const input = await screen.findByLabelText('Rename run to')
    await user.clear(input)
    await user.type(input, 'go')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await user.click(await screen.findByRole('button', { name: 'Rename in 3 files' }))
    await screen.findByRole('alert')
    await act(() => getController(store).flushAll())
    expect(await diskText(store, 'c.ts')).toBe('const runner = go\n')
  })
})
