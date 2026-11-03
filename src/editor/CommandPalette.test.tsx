import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { editorHandleAtom } from '../state/editorAtoms'
import { getController } from '../workspace/controller'
import { activePathAtom, treeAtom, workspaceStatusAtom } from '../state/workspaceAtoms'

function mount() {
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  return store
}

/** Opens the palette in command mode, as Mod-Shift-P does. */
async function openCommands(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
  return screen.getByRole('combobox') as HTMLInputElement
}

describe('command palette: new file or folder', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  async function readyWithFolders(store: ReturnType<typeof createStore>) {
    await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
    await waitFor(() => expect(store.get(editorHandleAtom)).toBeTruthy())
    const c = getController(store)
    await act(async () => {
      await c.createFolder('src')
      await c.createFolder('lib')
    })
  }

  it('creates a file in the folder chosen from the palette', async () => {
    const user = userEvent.setup()
    const store = mount()
    await readyWithFolders(store)

    const input = await openCommands(user)
    await user.type(input, 'new file')
    await user.keyboard('{Enter}')

    // The location step lists the workspace root and every folder.
    expect(screen.getByRole('option', { name: '/ (workspace root)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'src/' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'lib/' })).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'src/' }))
    await user.type(screen.getByRole('combobox'), 'app.ts')
    expect(screen.getByText('Create file src/app.ts (Enter)')).toBeInTheDocument()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(store.get(activePathAtom)).toBe('src/app.ts'))
    expect(store.get(treeAtom).some((e) => e.path === 'src/app.ts')).toBe(true)
  })

  it('creates a folder at the workspace root', async () => {
    const user = userEvent.setup()
    const store = mount()
    await readyWithFolders(store)

    const input = await openCommands(user)
    await user.type(input, 'new folder')
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('option', { name: '/ (workspace root)' }))
    await user.type(screen.getByRole('combobox'), 'docs')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(store.get(treeAtom).some((e) => e.path === 'docs' && e.kind === 'dir')).toBe(
        true,
      ),
    )
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('Escape in the name step goes back to commands instead of closing', async () => {
    const user = userEvent.setup()
    const store = mount()
    await readyWithFolders(store)

    const input = await openCommands(user)
    await user.type(input, 'new file')
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('option', { name: 'lib/' }))
    await user.keyboard('{Escape}')

    const back = screen.getByRole('combobox') as HTMLInputElement
    expect(back.value).toBe('>')
    expect(screen.getByRole('option', { name: 'File: New File' })).toBeInTheDocument()
  })
})
