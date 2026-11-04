import { undo } from '@codemirror/commands'
import { act, render, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import git from 'isomorphic-git'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { computeHunks } from '../review/diff'
import { gitHeadAtom } from '../state/gitAtoms'
import { editorHandleAtom } from '../state/editorAtoms'
import {
  noticeAtom,
  reconnectPromptAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { getController } from './controller'
import { createGitFs } from './gitFs'
import { GitService } from './gitService'
import { MemDisk } from './testing/memoryDisk'

const enc = (s: string) => new TextEncoder().encode(s)
const author = { name: 'T', email: 't@example.com' }
const HEAD = 'a\nb\nc\nd\ne\nf\ng\nh\n'
// Not the same size as HEAD: the in-memory disk has no mtimes, so git's stat cache would call equal sizes unchanged.
const WORK = 'a\nBB\nc\nd\ne\ng\nh\ni\n'

/** A mounted app whose linked folder is a repo with HEAD = a.txt, edited on disk to WORK. */
async function repo() {
  globalThis.indexedDB = new IDBFactory()
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  const disk = new MemDisk()
  const root = disk.handle()
  const fs = createGitFs(root as never)
  disk.setFile('a.txt', enc(HEAD))
  await git.init({ fs, dir: '/' })
  await git.add({ fs, dir: '/', filepath: 'a.txt' })
  await git.commit({ fs, dir: '/', message: 'init', author })
  disk.setFile('a.txt', enc(WORK))
  const controller = getController(store)
  await act(async () => {
    await controller.importFolderHandle(root as never)
    await controller.openFile('a.txt')
  })
  await waitFor(() => expect(store.get(gitHeadAtom).status.get('a.txt')).toBe('modified'))
  const hunks = computeHunks(HEAD, WORK)
  const index = async () => {
    const [row] = await git.statusMatrix({ fs, dir: '/', filepaths: ['a.txt'] })
    return row!.slice(1)
  }
  const indexText = async () => {
    return new GitService(root as never).readIndex('a.txt')
  }
  return { store, disk, controller, hunks, index, indexText }
}

describe('staging from the review pane', () => {
  it('stages one hunk, then unstages it, refreshing the git status each time', async () => {
    const { store, controller, hunks, indexText } = await repo()
    const before = store.get(gitHeadAtom).version
    await act(() => controller.reviewAction('a.txt', 'stage', hunks[0]!))
    expect(await indexText()).toBe('a\nBB\nc\nd\ne\nf\ng\nh\n')
    expect(store.get(noticeAtom)).toEqual({ kind: 'info', text: 'Staged the hunk.' })
    expect(store.get(gitHeadAtom).version).toBeGreaterThan(before)

    await act(() => controller.reviewAction('a.txt', 'stage', hunks[0]!))
    expect(await indexText()).toBe(HEAD)
    expect(store.get(noticeAtom)?.text).toBe('Unstaged the hunk.')
  })

  it('put only stages: a staged hunk stays staged', async () => {
    const { store, controller, hunks, indexText } = await repo()
    await act(() => controller.reviewAction('a.txt', 'put', hunks[2]!))
    await act(() => controller.reviewAction('a.txt', 'put', hunks[2]!))
    expect(await indexText()).toBe('a\nb\nc\nd\ne\nf\ng\nh\ni\n')
    expect(store.get(noticeAtom)?.text).toBe('The hunk is already staged.')
  })

  it('stages and unstages the whole file when no hunk is given', async () => {
    const { controller, indexText, index } = await repo()
    await act(() => controller.reviewAction('a.txt', 'stage', null))
    expect(await indexText()).toBe(WORK)
    expect(await index()).toEqual([1, 2, 2])
    await act(() => controller.reviewAction('a.txt', 'stage', null))
    expect(await indexText()).toBe(HEAD)
  })

  it('reverts a hunk through the editor so undo restores it, and says so', async () => {
    const { store, controller, hunks } = await repo()
    const view = store.get(editorHandleAtom)!.view
    expect(view.state.doc.toString()).toBe(WORK)
    await act(() => controller.reviewAction('a.txt', 'revert', hunks[0]!))
    expect(view.state.doc.toString()).toBe('a\nb\nc\nd\ne\ng\nh\ni\n')
    expect(store.get(noticeAtom)).toMatchObject({ kind: 'info' })
    expect(store.get(noticeAtom)?.text).toMatch(/Reverted .* Undo/)
    act(() => {
      undo(view)
    })
    expect(view.state.doc.toString()).toBe(WORK)
  })

  it('asks for a hunk before reverting', async () => {
    const { store, controller } = await repo()
    await act(() => controller.reviewAction('a.txt', 'obtain', null))
    expect(store.get(noticeAtom)?.text).toMatch(/cursor onto a changed hunk/)
  })

  it('pauses the link, prompts to reconnect and writes nothing when access is read-only', async () => {
    const { store, controller, hunks, disk, indexText } = await repo()
    disk.access = 'readonly'
    await act(() => controller.reviewAction('a.txt', 'stage', hunks[0]!))
    expect(store.get(noticeAtom)).toMatchObject({ kind: 'error' })
    expect(store.get(noticeAtom)?.text).toMatch(/write access/)
    expect(store.get(reconnectPromptAtom)).toBe(true)
    disk.access = 'granted'
    expect(await indexText()).toBe(HEAD)
  })
})
