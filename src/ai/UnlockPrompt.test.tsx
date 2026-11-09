import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVault, isUnlocked, lock, resetVaultForTests } from '../vault/vault'
import { chatMessagesAtom, retryChat } from './chat'
import CompanionChat from './CompanionChat'

// Real vault, but the default Plan route (Gemini) needs a key, so a locked vault matters.
beforeEach(() => resetVaultForTests())

describe('inline vault unlock', () => {
  it('asks for the passphrase in the chat before the first send, and hides once unlocked', async () => {
    await createVault('pw')
    lock()
    const user = userEvent.setup()
    render(
      <Provider store={createStore()}>
        <CompanionChat />
      </Provider>,
    )
    const field = await screen.findByLabelText('Vault passphrase')
    await user.type(field, 'wrong{Enter}')
    expect(await screen.findByText(/Wrong passphrase/)).toBeTruthy()
    await user.clear(field)
    await user.type(field, 'pw{Enter}')
    await waitFor(() => expect(screen.queryByLabelText('Vault passphrase')).toBeNull())
    expect(isUnlocked()).toBe(true)
  })

  it('does not nag when there is no vault', async () => {
    render(
      <Provider store={createStore()}>
        <CompanionChat />
      </Provider>,
    )
    await screen.findByText(/Ask anything about code/)
    expect(screen.queryByLabelText('Vault passphrase')).toBeNull()
  })
})

describe('retryChat', () => {
  it('drops the failed reply and sends the last message again', async () => {
    const store = createStore()
    store.set(chatMessagesAtom, [
      { id: 901, role: 'user', content: 'first' },
      { id: 902, role: 'assistant', content: 'ok' },
      { id: 903, role: 'user', content: 'again please' },
      { id: 904, role: 'assistant', content: '', error: 'Vault is locked' },
    ])
    const seen: string[] = []
    const adapter = {
      id: 'ollama',
      listModels: async () => [],
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('unused')
      },
      async *chat(req: { messages: { role: string; content?: string }[] }) {
        seen.push(JSON.stringify(req.messages.map((m) => m.content)))
        yield { type: 'text' as const, text: 'sure' }
      },
    }
    const resolve = (async () => ({
      adapter,
      route: { provider: 'ollama', model: 'm' },
    })) as never
    const host = {
      tree: async () => [],
      read: async () => null,
      search: async () => ({ hits: [], truncated: false }),
      write: async () => true,
    }
    await retryChat(store, resolve, host)
    const all = store.get(chatMessagesAtom)
    expect(all.map((m) => m.content)).toEqual(['first', 'ok', 'again please', 'sure'])
    expect(seen[0]).toBe('["first","ok","again please"]')
    vi.restoreAllMocks()
  })
})
