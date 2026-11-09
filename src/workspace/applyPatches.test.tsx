import { act, render, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { editorHandleAtom } from '../state/editorAtoms'
import { activePathAtom, noticeAtom, workspaceStatusAtom } from '../state/workspaceAtoms'
import type { FilePatch } from '../workflow/types'
import { getController } from './controller'
import { MemDisk } from './testing/memoryDisk'
import type { WorkspaceFS } from './types'

type Store = ReturnType<typeof createStore>

async function setup() {
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  const disk = new MemDisk()
  await act(async () => {
    await getController(store).importFolderHandle(disk.handle() as never)
  })
  return store
}

const fsOf = (store: Store) => (getController(store) as unknown as { fs: WorkspaceFS }).fs
const doc = (store: Store) => store.get(editorHandleAtom)!.view.state.doc.toString()

/** Writes the file straight to disk and opens it, so the editor's undo history starts empty. */
async function seed(store: Store, path: string, text: string) {
  await fsOf(store).write(path, text)
  await act(async () => {
    await getController(store).openFile(path)
  })
  await waitFor(() => expect(store.get(activePathAtom)).toBe(path))
  await waitFor(() => expect(doc(store)).toBe(text))
}

const apply = (store: Store, patches: FilePatch[]) =>
  act(() => getController(store).applyPatches(patches))

describe('applyPatches', () => {
  it('edits an open file through the buffer, saves it, and Ctrl-Z undoes it', async () => {
    const store = await setup()
    await seed(store, 'a.ts', 'one\n')
    expect(await apply(store, [{ path: 'a.ts', base: 'one\n', content: 'two\n' }])).toBe(
      true,
    )
    expect(doc(store)).toBe('two\n')
    expect(await fsOf(store).read('a.ts')).toBe('two\n')
    act(() => void undo(store.get(editorHandleAtom)!.view))
    expect(doc(store)).toBe('one\n')
  })

  it('creates a new file and applies several files together', async () => {
    const store = await setup()
    await seed(store, 'a.ts', 'one\n')
    const ok = await apply(store, [
      { path: 'a.ts', base: 'one\n', content: 'two\n' },
      { path: 'src/n.ts', base: null, content: 'new\n' },
    ])
    expect(ok).toBe(true)
    expect(await fsOf(store).read('a.ts')).toBe('two\n')
    expect(await fsOf(store).read('src/n.ts')).toBe('new\n')
  })

  it('writes nothing when any file changed since the plan', async () => {
    const store = await setup()
    await seed(store, 'a.ts', 'one\n')
    await seed(store, 'b.ts', 'edited meanwhile\n')
    const ok = await apply(store, [
      { path: 'a.ts', base: 'one\n', content: 'two\n' },
      { path: 'b.ts', base: 'old\n', content: 'x\n' },
    ])
    expect(ok).toBe(false)
    expect(await fsOf(store).read('a.ts')).toBe('one\n')
    expect(await fsOf(store).read('b.ts')).toBe('edited meanwhile\n')
    expect(store.get(noticeAtom)?.text).toMatch(/b\.ts changed since the plan/)
  })

  it('refuses to create a file that now exists', async () => {
    const store = await setup()
    await seed(store, 'a.ts', 'one\n')
    expect(await apply(store, [{ path: 'a.ts', base: null, content: 'x\n' }])).toBe(false)
    expect(await fsOf(store).read('a.ts')).toBe('one\n')
  })

  it('sees unsaved buffer text as the current text', async () => {
    const store = await setup()
    await seed(store, 'a.ts', 'one\n')
    const v = store.get(editorHandleAtom)!.view
    act(() => v.dispatch({ changes: { from: 0, insert: 'typed ' } }))
    expect(await apply(store, [{ path: 'a.ts', base: 'one\n', content: 'two\n' }])).toBe(
      false,
    )
    expect(doc(store)).toBe('typed one\n')
  })
})
