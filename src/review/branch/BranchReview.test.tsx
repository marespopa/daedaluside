import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import { vi } from 'vitest'
import App from '../../App'
import {
  branchConfirmAtom,
  branchMarksAtom,
  branchReviewAtom,
  branchStatsAtom,
  type BranchReviewState,
  branchTabActiveAtom,
} from '../../state/branchReviewAtoms'
import { workspaceStatusAtom } from '../../state/workspaceAtoms'
import { getController } from '../../workspace/controller'
import { MemDisk } from '../../workspace/testing/memoryDisk'
import type { BranchFile } from '../../workspace/gitService'
import { getReviewPane } from '../reviewPane'
import { isReviewed, markFile, marksKey, loadMarks, pruneMarks, saveMarks } from './marks'

const files: BranchFile[] = [
  { path: 'src/a.ts', status: 'M', mbOid: 'a1', headOid: 'a2' },
  { path: 'src/b.ts', status: 'A', mbOid: null, headOid: 'b2' },
  { path: 'logo.png', status: 'M', mbOid: 'p1', headOid: 'p2' },
]

const state = (over: Partial<BranchReviewState> = {}): BranchReviewState => ({
  mode: 'base',
  base: 'main',
  branch: 'feature',
  status: 'ready',
  message: null,
  mergeBase: 'mb',
  head: 'hd',
  files,
  index: 0,
  focus: 'index',
  ...over,
})

async function setup(over: Partial<BranchReviewState> = {}) {
  globalThis.indexedDB = new IDBFactory()
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  const controller = getController(store)
  vi.spyOn(controller, 'branchFileContent').mockImplementation(async (f) =>
    f.path === 'logo.png'
      ? { placeholder: '[Binary file changed — Click to inspect metadata]' }
      : { base: 'one\ntwo\n', current: 'one\nTWO\nthree\n' },
  )
  vi.spyOn(controller, 'branchFileMeta').mockResolvedValue(
    'base: p1, 3 bytes · head: p2, 4 bytes',
  )
  act(() => {
    store.set(branchStatsAtom, {
      stats: { 'src/a.ts': { add: 2, del: 1 }, 'src/b.ts': { add: 3, del: 0 } },
      done: true,
    })
    store.set(branchReviewAtom, state(over))
    store.set(branchTabActiveAtom, true)
  })
  await screen.findByTestId('branch-review')
  return { store, controller, user: userEvent.setup() }
}

const index = () => screen.getByRole('listbox', { name: 'Branch files' })
const selected = (store: ReturnType<typeof createStore>) =>
  store.get(branchReviewAtom)!.index

describe('marks', () => {
  it('counts a mark only while both blob oids still match, and prunes the rest', () => {
    const a = files[0]!
    const marks = markFile({}, a, true)
    expect(isReviewed(marks, a)).toBe(true)
    expect(isReviewed(marks, { ...a, headOid: 'changed' })).toBe(false)
    expect(pruneMarks(marks, [{ ...a, headOid: 'changed' }])).toEqual({})
    expect(isReviewed(markFile(marks, a, false), a)).toBe(false)
  })

  it('persists across reloads under a per-workspace key', () => {
    const key = marksKey('ws1', 'main', 'feature')
    saveMarks(key, markFile({}, files[0]!, true))
    expect(isReviewed(loadMarks(key), files[0]!)).toBe(true)
    saveMarks(key, {})
    expect(loadMarks(key)).toEqual({})
    expect(localStorage.getItem(key)).toBeNull()
  })
})

describe('branch review surface', () => {
  it('shows the header, the file tree with markers, and the progress', async () => {
    await setup()
    expect(screen.getByRole('button', { name: /vs main/ })).toBeInTheDocument()
    expect(screen.getByTestId('branch-totals')).toHaveTextContent('+5 -1')
    expect(screen.getByText('src/')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(document.querySelectorAll('[data-reviewed="false"]')).toHaveLength(3)
    expect(screen.getByTestId('branch-progress')).toHaveTextContent('0 / 3 reviewed')
    await waitFor(() =>
      expect(document.querySelectorAll('.cm-diff-line-change').length).toBeGreaterThan(0),
    )
  })

  it('each file has a checkbox that shows and sets its reviewed mark', async () => {
    const { store, user } = await setup()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    boxes.forEach((b) => expect(b).toHaveAttribute('aria-checked', 'false'))
    const before = selected(store)
    await user.click(boxes[1]!)
    expect(boxes[1]).toHaveAttribute('aria-checked', 'true')
    expect(selected(store)).toBe(before)
    expect(screen.getByTestId('branch-progress')).toHaveTextContent('1 / 3 reviewed')
    await user.click(boxes[1]!)
    expect(boxes[1]).toHaveAttribute('aria-checked', 'false')
    expect(store.get(branchMarksAtom)).toEqual({})
  })

  it('switching workspace drops the old review and its marks, then reads the new one', async () => {
    const { store, controller } = await setup()
    act(() => store.set(branchMarksAtom, markFile({}, files[0]!, true)))
    const first = new MemDisk()
    const second = new MemDisk()
    await act(async () => {
      await controller.importFolderHandle(first.handle('one') as never)
      await controller.importFolderHandle(second.handle('two') as never)
    })
    const s = store.get(branchReviewAtom)
    // The stale review (src/a.ts, src/b.ts, logo.png) is gone; a fresh read replaced it.
    expect(s?.files.map((f) => f.path) ?? []).not.toContain('src/a.ts')
    expect(store.get(branchMarksAtom)).toEqual({})
  })

  it('moves the selection with j and k', async () => {
    const { store, user } = await setup()
    await waitFor(() => expect(index()).toHaveFocus())
    await user.keyboard('j')
    expect(selected(store)).toBe(1)
    await user.keyboard('jk')
    expect(selected(store)).toBe(1)
  })

  it('n and arrows only move; c approves the file left behind and advances', async () => {
    const { store, user } = await setup()
    await waitFor(() => expect(index()).toHaveFocus())
    await user.keyboard('n')
    expect(selected(store)).toBe(1)
    expect(Object.keys(store.get(branchMarksAtom))).toEqual([])
    await user.keyboard('{ArrowLeft}')
    expect(selected(store)).toBe(0)
    await user.keyboard('c')
    expect(selected(store)).toBe(1)
    expect(Object.keys(store.get(branchMarksAtom))).toEqual(['src/a.ts'])
    expect(screen.getByTestId('branch-progress')).toHaveTextContent('1 / 3 reviewed')
    await user.keyboard('p')
    expect(selected(store)).toBe(0)
    expect(Object.keys(store.get(branchMarksAtom))).toEqual(['src/a.ts'])
  })

  it('Enter approves and advances; on a reviewed file it takes the approval back', async () => {
    const { store, user } = await setup()
    await waitFor(() => expect(index()).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(selected(store)).toBe(1)
    expect(Object.keys(store.get(branchMarksAtom))).toEqual(['src/a.ts'])
    await user.keyboard('p{Enter}')
    expect(selected(store)).toBe(0)
    expect(Object.keys(store.get(branchMarksAtom))).toEqual([])
  })

  it('a toggles the reviewed mark and advances; toggling a reviewed file clears it', async () => {
    const { store, user } = await setup()
    await waitFor(() => expect(index()).toHaveFocus())
    await user.keyboard('a')
    expect(selected(store)).toBe(1)
    expect(store.get(branchMarksAtom)['src/a.ts']).toBeDefined()
    await user.keyboard('p')
    await user.keyboard('a')
    expect(store.get(branchMarksAtom)['src/a.ts']).toBeUndefined()
  })

  it(':BRReset clears every mark', async () => {
    const { store, controller } = await setup()
    act(() => {
      store.set(branchMarksAtom, markFile({}, files[0]!, true))
    })
    act(() => controller.resetBranchReviewed())
    expect(store.get(branchMarksAtom)).toEqual({})
  })

  it('asks before reverting a file, and cancels on any other key', async () => {
    const { store, controller, user } = await setup()
    const revert = vi.spyOn(controller, 'revertBranchFile').mockResolvedValue()
    await waitFor(() => expect(index()).toHaveFocus())
    await user.keyboard('r')
    expect(store.get(branchConfirmAtom)).toEqual({ kind: 'file', path: 'src/a.ts' })
    expect(screen.getByRole('alert')).toHaveTextContent('Revert src/a.ts to base?')
    await user.keyboard('n')
    expect(store.get(branchConfirmAtom)).toBeNull()
    expect(revert).not.toHaveBeenCalled()
    await user.keyboard('r')
    await user.keyboard('y')
    expect(revert).toHaveBeenCalledWith(files[0])
  })

  it('e opens the file in its own tab and keeps the review open', async () => {
    const { store, controller, user } = await setup()
    const edit = vi.spyOn(controller, 'editBranchFile').mockResolvedValue()
    await waitFor(() => expect(index()).toHaveFocus())
    await user.keyboard('e')
    expect(edit).toHaveBeenCalledWith('src/a.ts')
    expect(store.get(branchReviewAtom)).not.toBeNull()
  })

  it('shows a tab that switches between the review and a file without closing it', async () => {
    const { store, user } = await setup()
    expect(screen.getByRole('tab', { name: 'Branch Review' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    store.set(branchTabActiveAtom, false)
    await waitFor(() => expect(screen.queryByTestId('branch-review')).toBeNull())
    expect(store.get(branchReviewAtom)).not.toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Branch Review' }))
    expect(await screen.findByTestId('branch-review')).toBeInTheDocument()
  })

  it('q closes the review', async () => {
    const { store, user } = await setup()
    await waitFor(() => expect(index()).toHaveFocus())
    await user.keyboard('q')
    expect(store.get(branchReviewAtom)).toBeNull()
  })

  it('Ctrl-W w switches focus between the index and the patch', async () => {
    const { store, user } = await setup()
    await waitFor(() => expect(index()).toHaveFocus())
    await user.keyboard('{Control>}w{/Control}w')
    expect(store.get(branchReviewAtom)!.focus).toBe('canvas')
    await waitFor(() => expect(getReviewPane()!.view.hasFocus).toBe(true))
    await user.keyboard('{Control>}w{/Control}w')
    expect(store.get(branchReviewAtom)!.focus).toBe('index')
  })

  it(']c jumps to hunks in the patch', async () => {
    const { user } = await setup({ focus: 'canvas' })
    await waitFor(() => expect(getReviewPane()!.view.hasFocus).toBe(true))
    await waitFor(() =>
      expect(document.querySelectorAll('.cm-diff-line-change').length).toBeGreaterThan(0),
    )
    await user.keyboard(']c')
    const v = getReviewPane()!.view
    expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(2)
  })

  it('sa approves the hunk under the cursor; sr asks before reverting it', async () => {
    const { store, controller, user } = await setup({ focus: 'canvas' })
    const approve = vi.spyOn(controller, 'approveBranchHunk')
    await waitFor(() => expect(getReviewPane()!.view.hasFocus).toBe(true))
    await waitFor(() =>
      expect(document.querySelectorAll('.cm-diff-line-change').length).toBeGreaterThan(0),
    )
    await user.keyboard(']c')
    await user.keyboard('sa')
    expect(approve).toHaveBeenCalledTimes(1)
    await user.keyboard('sr')
    expect(store.get(branchConfirmAtom)).toEqual({ kind: 'hunk', path: 'src/a.ts' })
  })

  it('shows a placeholder for binary files, and metadata on click', async () => {
    const { user } = await setup({ index: 2 })
    const btn = await screen.findByRole('button', { name: /Binary file changed/ })
    await user.click(btn)
    expect(await screen.findByText(/p1, 3 bytes/)).toBeInTheDocument()
  })

  it('draws only a window of a long file list, and keeps positions for assistive tech', async () => {
    const many: BranchFile[] = Array.from({ length: 1000 }, (_, i) => ({
      path: `d/f${String(i).padStart(4, '0')}.ts`,
      status: 'M' as const,
      mbOid: `m${i}`,
      headOid: `h${i}`,
    }))
    await setup({ files: many })
    const options = within(index()).getAllByRole('option')
    expect(options.length).toBeLessThan(100)
    expect(options[0]).toHaveAttribute('aria-posinset', '1')
    expect(options[0]).toHaveAttribute('aria-setsize', '1000')
  })

  it('shows the empty state for a branch with no changes', async () => {
    await setup({ files: [] })
    expect(
      screen.getByText('No differences from main, committed or uncommitted.'),
    ).toBeInTheDocument()
  })

  it('shows loading and error messages', async () => {
    const { store } = await setup({ status: 'loading', files: [] })
    expect(screen.getByRole('status', { name: 'Reading branch' })).toBeInTheDocument()
    act(() => {
      store.set(
        branchReviewAtom,
        state({ status: 'error', message: 'No common ancestor with base', files: [] }),
      )
    })
    expect(screen.getByRole('alert')).toHaveTextContent('No common ancestor with base')
  })
})
