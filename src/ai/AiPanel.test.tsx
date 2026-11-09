import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiOpenAtom } from '../state/aiAtoms'
import { companionOpenAtom, companionViewAtom } from '../state/companionAtoms'
import { createVault, resetVaultForTests, setKey } from '../vault/vault'
import AiPanel from './AiPanel'

const sse = (text: string) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`

/** Both default routes are Gemini: the first request is the plan, the second the edits. */
function mockFetch(plan: string, edits: string) {
  const calls: { url: string; body: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') })
      const text = sse(calls.length === 1 ? plan : edits)
      return new Response(text)
    }),
  )
  return calls
}

function mount() {
  const store = createStore()
  store.set(aiOpenAtom, true)
  render(
    <Provider store={store}>
      <AiPanel />
    </Provider>,
  )
  return store
}

beforeEach(() => resetVaultForTests())
afterEach(() => vi.unstubAllGlobals())

describe('AiPanel', () => {
  it('goes from a task to a plan to a patch review', async () => {
    const user = userEvent.setup()
    await createVault('p')
    await setKey('gemini', 'KEY')
    const calls = mockFetch(
      '1. Create `notes.md`',
      'FILE: notes.md\n<<<<<<< SEARCH\n=======\nhello\n>>>>>>> REPLACE\n',
    )
    mount()

    await user.type(screen.getByLabelText('What should change?'), 'add notes')
    await user.click(screen.getByRole('button', { name: 'Make plan' }))
    const plan = await screen.findByLabelText(/^Plan/)
    expect(plan).toHaveValue('1. Create `notes.md`')
    expect(calls[0]!.body).toContain('add notes')

    await user.type(plan, ' (edited)')
    await user.click(screen.getByRole('button', { name: 'Approve and write edits' }))
    expect(
      await screen.findByRole('dialog', { name: /Review changes/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 of 1 hunks selected/)).toBeInTheDocument()
    // The edited plan, not the model's original, went to the edit model.
    expect(calls.at(-1)!.body).toContain('(edited)')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('What should change?')).toBeInTheDocument()
  })

  it('asks for the key vault when it is locked and opens AI Configure', async () => {
    const user = userEvent.setup()
    mockFetch('x', 'y')
    const store = mount()
    await user.type(screen.getByLabelText('What should change?'), 'task')
    await user.click(screen.getByRole('button', { name: 'Make plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Vault is locked/)
    await user.click(screen.getByRole('button', { name: 'Open AI Configure' }))
    expect(store.get(companionOpenAtom)).toBe(true)
    expect(store.get(companionViewAtom)).toBe('config')
    expect(store.get(aiOpenAtom)).toBe(false)
  })

  it('shows Planning… at once and Escape cancels', async () => {
    const user = userEvent.setup()
    await createVault('p')
    await setKey('gemini', 'KEY')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init?: RequestInit) =>
          new Promise((_r, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('x', 'AbortError')),
            )
          }),
      ),
    )
    mount()
    await user.type(screen.getByLabelText('What should change?'), 'task')
    await user.click(screen.getByRole('button', { name: 'Make plan' }))
    expect(screen.getByRole('status')).toHaveTextContent('Planning…')
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancelled.')
  })

  it('closes with Escape when idle', async () => {
    const user = userEvent.setup()
    const store = mount()
    screen.getByLabelText('What should change?').focus()
    await user.keyboard('{Escape}')
    expect(store.get(aiOpenAtom)).toBe(false)
  })
})
