import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { describe, expect, it } from 'vitest'
import App from '../App'
import {
  companionOpenAtom,
  companionTabActiveAtom,
  sidecarOpenAtom,
} from '../state/companionAtoms'
import { chatMessagesAtom } from './chat'

function mount() {
  const store = createStore()
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  return { store, user: userEvent.setup() }
}

describe('AI chat sidecar', () => {
  it('toggles from the header and closes with Escape', async () => {
    const { store, user } = mount()
    const toggle = screen.getByRole('button', { name: 'AI chat' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(await screen.findByRole('complementary', { name: 'AI chat' })).toBeVisible()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Escape}')
    expect(store.get(sidecarOpenAtom)).toBe(false)
    expect(screen.queryByRole('complementary', { name: 'AI chat' })).toBeNull()
  })

  it('shows the same thread as the companion tab, and can move into the tab', async () => {
    const { store, user } = mount()
    store.set(chatMessagesAtom, [
      { id: 1, role: 'user', content: 'earlier question' },
      { id: 2, role: 'assistant', content: 'earlier answer' },
    ])
    await user.click(screen.getByRole('button', { name: 'AI chat' }))
    expect(await screen.findByText('earlier answer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open in AI Companion tab' }))
    expect(store.get(sidecarOpenAtom)).toBe(false)
    expect(store.get(companionOpenAtom)).toBe(true)
    expect(store.get(companionTabActiveAtom)).toBe(true)
    expect(await screen.findByText('earlier answer')).toBeInTheDocument()
  })

  it('opens from state without a workspace', async () => {
    const { store } = mount()
    await act(async () => store.set(sidecarOpenAtom, true))
    expect(await screen.findByRole('log', { name: 'Conversation' })).toBeInTheDocument()
  })
})
