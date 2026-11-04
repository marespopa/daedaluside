import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { activeBufferAtom, editorHandleAtom, grepOpenAtom } from '../state/editorAtoms'
import { activePathAtom, workspaceStatusAtom } from '../state/workspaceAtoms'
import { getController } from '../workspace/controller'
import { MemDisk } from '../workspace/testing/memoryDisk'

describe('live grep finder', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  async function setup() {
    const store = createStore()
    render(
      <Provider store={store}>
        <App />
      </Provider>,
    )
    await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
    await waitFor(() => expect(store.get(editorHandleAtom)).toBeTruthy())
    const handle = new MemDisk().handle()
    await act(async () => {
      await getController(store).importFolderHandle(handle as never)
    })
    const c = getController(store)
    await act(async () => {
      await c.createFile('notes/a.md')
      await c.createFile('src/b.ts')
    })
    // Write contents through the editor-less path: save by opening and typing is heavy,
    // so write straight to the folder and refresh the tree and index.
    const root = handle as unknown as FileSystemDirectoryHandle
    const write = async (dir: string, name: string, text: string) => {
      const d = await root.getDirectoryHandle(dir)
      const f = await (await d.getFileHandle(name)).createWritable()
      await f.write(new TextEncoder().encode(text))
      await f.close()
    }
    await write('notes', 'a.md', 'alpha\nbeta\n')
    await write('src', 'b.ts', 'const x = 1\nconst needle = 2\nconst y = 3\n')
    await act(async () => {
      // createFile left both files open as empty buffers; drop them so opening reads the disk.
      await c.closeAll()
      await c.refreshWorkspace()
    })
    return store
  }

  it('finds text across files and jumps to the line', async () => {
    const user = userEvent.setup()
    const store = await setup()

    await user.keyboard('{Control>}{Shift>}f{/Shift}{/Control}')
    const input = await screen.findByRole('combobox', { name: 'Live grep search' })
    await user.type(input, 'needle')

    const option = await screen.findByRole('option', { name: /src\/b\.ts:2/ })
    expect(option).toBeInTheDocument()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(store.get(activePathAtom)).toBe('src/b.ts'))
    await waitFor(() => expect(store.get(activeBufferAtom).line).toBe(2))
    expect(store.get(grepOpenAtom)).toBe(false)
  })

  it('says when nothing matches, and Escape closes', async () => {
    const user = userEvent.setup()
    const store = await setup()

    await user.keyboard('{Control>}{Shift>}f{/Shift}{/Control}')
    await user.type(await screen.findByRole('combobox'), 'zzzzqqq')
    expect(await screen.findByText('No matches')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Live grep' })).toBeNull()
    expect(store.get(grepOpenAtom)).toBe(false)
  })
})
