import { render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { computeHunks } from '../review/diff'
import { fileDiffMapAtom } from '../state/gitAtoms'
import { activePathAtom } from '../state/workspaceAtoms'
import DiffStat from './DiffStat'

function setup(path: string | null, base: string, current: string) {
  const store = createStore()
  store.set(activePathAtom, path)
  store.set(fileDiffMapAtom, new Map([['a.txt', computeHunks(base, current)]]))
  render(
    <Provider store={store}>
      <DiffStat />
    </Provider>,
  )
}

describe('DiffStat', () => {
  it('summarizes added, removed and hunks for the active file', () => {
    setup('a.txt', '1\n2\n3\n4\n5\n', 'x\n2\n3\n4\ny\nz\n')
    expect(screen.getByRole('status').textContent).toBe('+3 -2 • 2 hunks')
  })

  it('is hidden when the file matches HEAD or no file is active', () => {
    setup('a.txt', 'a\n', 'a\n')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
