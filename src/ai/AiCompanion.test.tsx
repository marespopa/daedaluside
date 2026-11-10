import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  companionOpenAtom,
  companionTabActiveAtom,
  companionViewAtom,
} from '../state/companionAtoms'
import { createVault, resetVaultForTests, setKey } from '../vault/vault'
import AiCompanion from './AiCompanion'
import { chatMessagesAtom } from './chat'

const sse = (text: string) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`

function mount() {
  const store = createStore()
  store.set(companionOpenAtom, true)
  store.set(companionTabActiveAtom, true)
  render(
    <Provider store={store}>
      <AiCompanion />
    </Provider>,
  )
  return { store, user: userEvent.setup() }
}

beforeEach(() => resetVaultForTests())
afterEach(() => vi.unstubAllGlobals())

describe('AiCompanion', () => {
  it('chats with the Plan model and keeps the history', async () => {
    await createVault('p')
    await setKey('gemini', 'KEY')
    const bodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''))
        return new Response(sse(bodies.length === 1 ? 'Hello there' : 'Second'))
      }),
    )
    const { store, user } = mount()
    await user.type(screen.getByLabelText('Message'), 'hi{Enter}')
    // The user's message shows at once, before the reply arrives.
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(await screen.findByText('Hello there')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('')

    await user.type(screen.getByLabelText('Message'), 'again{Enter}')
    expect(await screen.findByText('Second')).toBeInTheDocument()
    // The second request carries the first exchange.
    expect(bodies[1]).toContain('Hello there')
    expect(store.get(chatMessagesAtom)).toHaveLength(4)
  })

  it('sends on Enter but not on Shift+Enter', async () => {
    const { user } = mount()
    await user.type(screen.getByLabelText('Message'), 'a{Shift>}{Enter}{/Shift}b')
    expect(screen.getByLabelText('Message')).toHaveValue('a\nb')
  })

  it('unlocks the vault in the chat, then offers Configure when no key is saved', async () => {
    await createVault('p')
    resetVaultForTests() // locks it again
    const { store, user } = mount()
    await user.type(screen.getByLabelText('Message'), 'hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Vault is locked/)
    const fields = await screen.findAllByLabelText('Vault passphrase')
    await user.type(fields.at(-1)!, 'p{Enter}')
    // The message is sent again; the vault holds no Gemini key, so setup is the next step.
    expect(await screen.findByText(/No API key/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Configure' }))
    expect(store.get(companionViewAtom)).toBe('config')
    expect(await screen.findByText(/1\. Vault passphrase/)).toBeInTheDocument()
  })

  it('shows the AI configuration under Configure', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('tab', { name: 'Configure' }))
    expect(await screen.findByText(/1\. Vault passphrase/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/3\. Models/)).toBeInTheDocument())
  })

  it('is hidden, not unmounted, while another tab is focused', () => {
    const { store } = mount()
    store.set(companionTabActiveAtom, false)
    return waitFor(() =>
      expect(document.getElementById('ai-companion')).toHaveAttribute('hidden'),
    )
  })
})
