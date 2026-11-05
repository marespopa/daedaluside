import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import { vi } from 'vitest'
import App from '../App'
import {
  activeHunkIndexAtom,
  gitHeadAtom,
  reviewLayoutAtom,
  reviewOpenAtom,
  type GitStatus,
} from '../state/gitAtoms'
import {
  activePathAtom,
  treeAtom,
  treeStatusAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { getController } from '../workspace/controller'
import { getReviewPane, stepHunk } from './reviewPane'

const BASE = 'a\nb\nc\nd\ne\nf\ng\nh\n'
// Hunks: b -> B (line 2), f deleted (reached at line 6), i added (line 8).
const CURRENT = 'a\nB\nc\nd\ne\ng\nh\ni\n'

let current: ReturnType<typeof createStore>
const store = () => current

async function setup() {
  globalThis.indexedDB = new IDBFactory()
  const store = createStore()
  current = store
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await waitFor(() => expect(store.get(workspaceStatusAtom).state).toBe('ready'))
  const controller = getController(store)
  vi.spyOn(controller, 'reviewSnapshot').mockImplementation(async () => ({
    base: BASE,
    current: CURRENT,
  }))
  const openFile = vi.spyOn(controller, 'openFile').mockImplementation(async (p) => {
    store.set(activePathAtom, p)
  })
  const status = new Map<string, GitStatus>([
    ['a.txt', 'modified'],
    ['b.txt', 'modified'],
    ['c.txt', 'deleted'],
  ])
  act(() => {
    store.set(activePathAtom, 'a.txt')
    store.set(gitHeadAtom, { version: 1, status })
    store.set(reviewOpenAtom, true)
  })
  await screen.findByTestId('diff-review')
  await waitFor(() => expect(document.querySelector('.cm-diff-deleted')).not.toBeNull())
  const line = () => {
    const v = getReviewPane()!.view
    return v.state.doc.lineAt(v.state.selection.main.head).number
  }
  return { store, openFile, line, user: userEvent.setup() }
}

describe('stepHunk', () => {
  it('moves between anchors and wraps', () => {
    expect(stepHunk([2, 6, 8], 1, 1)).toBe(0)
    expect(stepHunk([2, 6, 8], 2, 1)).toBe(1)
    expect(stepHunk([2, 6, 8], 8, 1)).toBe(0)
    expect(stepHunk([2, 6, 8], 2, -1)).toBe(2)
    expect(stepHunk([2, 6, 8], 7, -1)).toBe(1)
    expect(stepHunk([2, 6, 8], 1, 2)).toBe(1)
    expect(stepHunk([], 1, 1)).toBe(-1)
  })
})

describe('diff review', () => {
  it('shows deleted lines inline and tints added and changed lines', async () => {
    await setup()
    const deleted = [...document.querySelectorAll('.cm-diff-deleted')].map(
      (e) => e.textContent,
    )
    expect(deleted).toEqual(['b', 'f'])
    expect(document.querySelectorAll('.cm-diff-line-change')).toHaveLength(1)
    expect(document.querySelectorAll('.cm-diff-line-add')).toHaveLength(1)
    expect(screen.getByTestId('diff-review')).toHaveAttribute('data-layout', 'unified')
  })

  it('moves between hunks with ]c and [c and tracks the active hunk', async () => {
    const { store, user, line } = await setup()
    await user.keyboard(']c')
    expect(line()).toBe(2)
    expect(store.get(activeHunkIndexAtom)).toBe(0)
    await user.keyboard(']c')
    expect(line()).toBe(6)
    expect(store.get(activeHunkIndexAtom)).toBe(1)
    await user.keyboard('[[c')
    expect(line()).toBe(2)
    expect(store.get(activeHunkIndexAtom)).toBe(0)
    await user.keyboard('[[c') // wraps to the last hunk
    expect(line()).toBe(8)
    expect(store.get(activeHunkIndexAtom)).toBe(2)
  })

  it('gg and G jump to the first and last hunk', async () => {
    const { user, line } = await setup()
    await user.keyboard('G')
    expect(line()).toBe(8)
    await user.keyboard('gg')
    expect(line()).toBe(2)
  })

  it('moves through modified files with ]f and [f, skipping deleted ones', async () => {
    const { user, openFile } = await setup()
    await user.keyboard(']f')
    expect(openFile).toHaveBeenLastCalledWith('b.txt')
    await user.keyboard(']f') // active is now b.txt: wraps to a.txt
    expect(openFile).toHaveBeenLastCalledWith('a.txt')
    await user.keyboard('[[f')
    expect(openFile).toHaveBeenLastCalledWith('b.txt')
  })

  it('closes on q and on Escape', async () => {
    const { store, user } = await setup()
    await user.keyboard('q')
    expect(store.get(reviewOpenAtom)).toBe(false)
    expect(screen.queryByTestId('diff-review')).toBeNull()

    act(() => store.set(reviewOpenAtom, true))
    await screen.findByTestId('diff-review')
    await user.keyboard('{Escape}')
    expect(store.get(reviewOpenAtom)).toBe(false)
  })

  it('Ctrl-W w moves focus from the pane to the file tree and back', async () => {
    const { store, user } = await setup()
    act(() => {
      store.set(treeStatusAtom, { state: 'ready' })
      store.set(treeAtom, [{ name: 'a.txt', path: 'a.txt', kind: 'file', size: 1 }])
      getReviewPane()!.view.focus()
    })
    await user.keyboard('{Control>}w{/Control}w')
    expect(document.activeElement?.closest('[aria-label="File tree"]')).not.toBeNull()
    await user.keyboard('{Control>}w{/Control}w')
    expect(getReviewPane()!.view.hasFocus).toBe(true)
  })

  it('maps s, X and u to stage and revert for the hunk under the cursor', async () => {
    const { user } = await setup()
    const controller = getController(store())
    const act = vi.spyOn(controller, 'reviewAction').mockResolvedValue()
    await user.keyboard(']c')
    await user.keyboard('s')
    expect(act).toHaveBeenLastCalledWith(
      'a.txt',
      'stage',
      expect.objectContaining({ kind: 'change' }),
    )
    await user.keyboard(' ')
    expect(act).toHaveBeenLastCalledWith(
      'a.txt',
      'stage',
      expect.objectContaining({ kind: 'change' }),
    )
    await user.keyboard('X')
    expect(act).toHaveBeenLastCalledWith(
      'a.txt',
      'revert',
      expect.objectContaining({ kind: 'change' }),
    )
    await user.keyboard('u')
    expect(act).toHaveBeenLastCalledWith(
      'a.txt',
      'revert',
      expect.objectContaining({ kind: 'change' }),
    )
    await user.keyboard('dp')
    expect(act).toHaveBeenLastCalledWith(
      'a.txt',
      'put',
      expect.objectContaining({ kind: 'change' }),
    )
    await user.keyboard('do')
    expect(act).toHaveBeenLastCalledWith(
      'a.txt',
      'obtain',
      expect.objectContaining({ kind: 'change' }),
    )
  })

  it('stages the whole file when the cursor is on no hunk', async () => {
    const { user } = await setup()
    const act = vi.spyOn(getController(store()), 'reviewAction').mockResolvedValue()
    await user.keyboard('s') // line 1 is unchanged
    expect(act).toHaveBeenLastCalledWith('a.txt', 'stage', null)
  })
})

const reviewEditors = () => [
  ...screen.getByTestId('diff-review').querySelectorAll<HTMLElement>('.cm-editor'),
]

describe('split diff review', () => {
  async function split() {
    const ctx = await setup()
    act(() => ctx.store.set(reviewLayoutAtom, 'split'))
    await waitFor(() => expect(reviewEditors()).toHaveLength(2))
    await waitFor(() => expect(document.querySelector('.cm-diff-spacer')).not.toBeNull())
    return ctx
  }
  const halves = () => {
    const [left, right] = reviewEditors()
    return { left: left!, right: right! }
  }

  it('shows HEAD on the left and the working tree on the right', async () => {
    await split()
    const { left, right } = halves()
    expect(screen.getByTestId('diff-review')).toHaveAttribute('data-layout', 'split')
    expect(left.querySelector('.cm-content')!.textContent).toContain('f')
    expect(left.querySelector('.cm-content')!.textContent).not.toContain('B')
    expect(right.querySelector('.cm-content')!.textContent).toContain('B')
    expect(document.querySelector('.cm-diff-deleted')).toBeNull()
    expect(left.closest('.border-r')).not.toBeNull()
  })

  it('tints hunk lines on each side and pads the shorter side', async () => {
    await split()
    const { left, right } = halves()
    // b -> B changes one line on both sides; f is removed on the left; i is added on the right.
    expect(left.querySelectorAll('.cm-diff-line-change')).toHaveLength(1)
    expect(left.querySelectorAll('.cm-diff-line-remove')).toHaveLength(1)
    expect(right.querySelectorAll('.cm-diff-line-change')).toHaveLength(1)
    expect(right.querySelectorAll('.cm-diff-line-add')).toHaveLength(1)
    // The removed line leaves a one-row gap on the right; the added line one on the left.
    expect(right.querySelectorAll('.cm-diff-spacer > div')).toHaveLength(1)
    expect(left.querySelectorAll('.cm-diff-spacer > div')).toHaveLength(1)
  })

  it('keeps the scroll position of both halves in step, in either direction', async () => {
    await split()
    const { left, right } = halves()
    const l = left.querySelector<HTMLElement>('.cm-scroller')!
    const r = right.querySelector<HTMLElement>('.cm-scroller')!
    l.scrollTop = 40
    fireEvent.scroll(l)
    expect(r.scrollTop).toBe(40)
    r.scrollTop = 15
    fireEvent.scroll(r)
    expect(l.scrollTop).toBe(15)
  })

  it('moves between hunks and stages from the right-hand half', async () => {
    const { user, line } = await split()
    const act2 = vi.spyOn(getController(store()), 'reviewAction').mockResolvedValue()
    await user.keyboard(']c')
    expect(line()).toBe(2)
    await user.keyboard('s')
    expect(act2).toHaveBeenLastCalledWith(
      'a.txt',
      'stage',
      expect.objectContaining({ kind: 'change' }),
    )
  })

  it('returns to the unified view when the layout changes back', async () => {
    const { store: st } = await split()
    act(() => st.set(reviewLayoutAtom, 'unified'))
    await waitFor(() => expect(reviewEditors()).toHaveLength(1))
    await waitFor(() => expect(document.querySelector('.cm-diff-deleted')).not.toBeNull())
  })
})
