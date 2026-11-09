import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { describe, expect, it } from 'vitest'
import { chatMessagesAtom } from './chat'
import CompanionChat from './CompanionChat'
import { matchCommands, submitChatInput } from './slashCommands'

describe('slash commands', () => {
  it('matches commands by prefix, only for a lone /word', () => {
    expect(matchCommands('/').length).toBeGreaterThan(3)
    expect(matchCommands('/su').map((c) => c.name)).toEqual(['summarize'])
    expect(matchCommands('hello')).toEqual([])
    expect(matchCommands('/clear now')).toEqual([])
  })

  it('/clear empties the conversation', async () => {
    const store = createStore()
    store.set(chatMessagesAtom, [{ id: 1, role: 'user', content: 'hi' }])
    await submitChatInput(store, '/clear')
    expect(store.get(chatMessagesAtom)).toEqual([])
  })

  it('/help and unknown commands add notices instead of messaging the model', async () => {
    const store = createStore()
    await submitChatInput(store, '/help')
    await submitChatInput(store, '/nope')
    const [help, unknown] = store.get(chatMessagesAtom)
    expect(help).toMatchObject({ notice: true })
    expect(help!.content).toContain('/summarize')
    expect(unknown!.content).toContain('Unknown command /nope')
  })

  it('/summarize with no history says so', async () => {
    const store = createStore()
    await submitChatInput(store, '/summarize')
    expect(store.get(chatMessagesAtom)[0]!.content).toBe('Nothing to summarize yet.')
  })

  it('shows suggestions while typing / and runs a command on Enter', async () => {
    const user = userEvent.setup()
    const store = createStore()
    store.set(chatMessagesAtom, [{ id: 1, role: 'user', content: 'hi' }])
    render(
      <Provider store={store}>
        <CompanionChat />
      </Provider>,
    )
    await user.type(screen.getByLabelText('Message'), '/cl')
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(store.get(chatMessagesAtom)).toEqual([])
  })
})
