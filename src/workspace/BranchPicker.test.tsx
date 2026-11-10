import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import git from 'isomorphic-git'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { gitBranchAtom } from '../state/gitAtoms'
import { activePathAtom, noticeAtom, workspaceStatusAtom } from '../state/workspaceAtoms'
import { getController } from './controller'
import { createGitFs } from './gitFs'
import { MemDisk } from './testing/memoryDisk'

const enc = (s: string) => new TextEncoder().encode(s)
const author = { name: 'T', email: 't@example.com' }
const text = (d: MemDisk, p: string) =>
  new TextDecoder().decode(d.files.get(p) ?? new Uint8Array())

/** A repo with `main` (a.txt "main") and `feature` (a.txt "feature"), checked out on main. */
async function repo() {
  const disk = new MemDisk()
  const fs = createGitFs(disk.handle() as unknown as FileSystemDirectoryHandle)
  disk.setFile('a.txt', enc('main\n'))
  await git.init({ fs, dir: '/', defaultBranch: 'main' })
  await git.add({ fs, dir: '/', filepath: 'a.txt' })
  await git.commit({ fs, dir: '/', message: 'init', author })
  await git.branch({ fs, dir: '/', ref: 'feature', checkout: true })
  disk.setFile('a.txt', enc('feature\n'))
  await git.add({ fs, dir: '/', filepath: 'a.txt' })
  await git.commit({ fs, dir: '/', message: 'feature', author })
  await git.checkout({ fs, dir: '/', ref: 'main' })
  return disk
}

async function openHome(disk: MemDisk) {
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
  await waitFor(() => expect(store.get(activePathAtom)).toBe('a.txt'))
  await act(async () => {
    getController(store).showHome()
  })
  await waitFor(() => expect(store.get(gitBranchAtom)).toBe('main'))
  return store
}

describe('branch picker on the opener', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('lists the branches and switches to the one picked', async () => {
    const user = userEvent.setup()
    const disk = await repo()
    const store = await openHome(disk)
    const o = await screen.findByRole('region', { name: 'Workspace opener' })

    await user.click(within(o).getByRole('button', { name: /Switch branch/ }))
    const list = await screen.findByRole('listbox', { name: 'Branches' })
    expect(
      within(list)
        .getAllByRole('option')
        .map((x) => x.textContent),
    ).toEqual(['feature', 'maincurrent'])
    await user.click(within(list).getByRole('option', { name: 'feature' }))

    await waitFor(() => expect(store.get(gitBranchAtom)).toBe('feature'))
    expect(text(disk, 'a.txt')).toBe('feature\n')
    expect(
      await within(o).findByRole('button', { name: /Current branch feature/ }),
    ).toBeInTheDocument()
  })

  it('filters the list', async () => {
    const user = userEvent.setup()
    const store = await openHome(await repo())
    void store
    const o = await screen.findByRole('region', { name: 'Workspace opener' })
    await user.click(within(o).getByRole('button', { name: /Switch branch/ }))
    await user.type(
      await screen.findByRole('textbox', { name: 'Filter branches' }),
      'fea',
    )
    const list = screen.getByRole('listbox', { name: 'Branches' })
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    await user.clear(screen.getByRole('textbox', { name: 'Filter branches' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter branches' }), 'zzz')
    expect(screen.getByText('No matching branches')).toBeInTheDocument()
  })

  it('refuses to switch while tracked files have uncommitted changes', async () => {
    const user = userEvent.setup()
    const disk = await repo()
    const store = await openHome(disk)
    disk.setFile('a.txt', enc('my edit\n'))
    const o = await screen.findByRole('region', { name: 'Workspace opener' })
    await user.click(within(o).getByRole('button', { name: /Switch branch/ }))
    await user.click(await screen.findByRole('option', { name: 'feature' }))

    await waitFor(() =>
      expect(store.get(noticeAtom)?.text ?? '').toMatch(/uncommitted changes/),
    )
    expect(store.get(gitBranchAtom)).toBe('main')
    expect(text(disk, 'a.txt')).toBe('my edit\n')
  })
})
