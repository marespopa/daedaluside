import { render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { describe, expect, it } from 'vitest'
import { vimEnabledAtom, vimStatusAtom } from '../state/editorAtoms'
import { activePathAtom } from '../state/workspaceAtoms'
import VimStatus from './VimStatus'

function renderWith(setup: (store: ReturnType<typeof createStore>) => void) {
  const store = createStore()
  setup(store)
  return render(
    <Provider store={store}>
      <VimStatus />
    </Provider>,
  )
}

describe('VimStatus', () => {
  it('shows the mode while Vim mode is on and a file is open', () => {
    renderWith((s) => {
      s.set(vimEnabledAtom, true)
      s.set(activePathAtom, 'a.md')
      s.set(vimStatusAtom, { label: 'INSERT', prompt: false })
    })
    expect(screen.getByRole('status')).toHaveTextContent('INSERT')
  })

  it('stays hidden when Vim mode is off', () => {
    renderWith((s) => {
      s.set(vimEnabledAtom, false)
      s.set(activePathAtom, 'a.md')
      s.set(vimStatusAtom, { label: 'NORMAL', prompt: false })
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('hides while the : or / line is open, and when no file is open', () => {
    renderWith((s) => {
      s.set(vimEnabledAtom, true)
      s.set(activePathAtom, 'a.md')
      s.set(vimStatusAtom, { label: 'NORMAL', prompt: true })
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('hides on the blank page', () => {
    renderWith((s) => {
      s.set(vimEnabledAtom, true)
      s.set(vimStatusAtom, { label: 'NORMAL', prompt: false })
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
