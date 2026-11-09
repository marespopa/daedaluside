import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadRoutes } from '../router/router'
import {
  createVault,
  getKey,
  lock,
  resetVaultForTests,
  setKey,
  vaultStatus,
} from '../vault/vault'
import AiSettings from './AiSettings'

beforeEach(() => resetVaultForTests())
afterEach(() => vi.unstubAllGlobals())

/** Makes `fetch` list models like Anthropic's API, or fail like a network that is down. */
function stubModels(up: boolean, ids: string[] = ['claude-sonnet-5-5']) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (!up) throw new TypeError('offline')
      return Response.json({ data: ids.map((id) => ({ id })) })
    }),
  )
}

async function unlockedVault() {
  await createVault('p')
}

describe('AiSettings', () => {
  it('creates a vault, stores a key, and locks again', async () => {
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.type(await screen.findByLabelText('New vault passphrase'), 'hunter2')
    await user.type(screen.getByLabelText('Repeat vault passphrase'), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Create vault' }))
    expect(await screen.findByText('Key vault is unlocked')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Gemini API key'), '  SECRET  ')
    await user.click(screen.getByRole('button', { name: 'Save Gemini API key' }))
    expect(
      await screen.findByRole('button', { name: 'Remove Gemini API key' }),
    ).toBeInTheDocument()
    expect(getKey('gemini')).toBe('SECRET')
    // The field is cleared and never shows the key back.
    expect(screen.getByLabelText('Gemini API key')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Lock' }))
    expect(await screen.findByLabelText('Vault passphrase')).toBeInTheDocument()
    expect(await vaultStatus()).toBe('locked')
  })

  it('shows an error for a wrong passphrase and unlocks with the right one', async () => {
    const user = userEvent.setup()
    await createVault('right')
    lock()
    render(<AiSettings />)
    await user.type(await screen.findByLabelText('Vault passphrase'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Error: Wrong passphrase.')

    await user.clear(screen.getByLabelText('Vault passphrase'))
    await user.type(screen.getByLabelText('Vault passphrase'), 'right')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('Key vault is unlocked')).toBeInTheDocument()
  })

  it('removes a stored key', async () => {
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.type(await screen.findByLabelText('New vault passphrase'), 'p')
    await user.type(screen.getByLabelText('Repeat vault passphrase'), 'p')
    await user.click(screen.getByRole('button', { name: 'Create vault' }))
    await user.type(await screen.findByLabelText('Anthropic API key'), 'k')
    await user.click(screen.getByRole('button', { name: 'Save Anthropic API key' }))
    await user.click(
      await screen.findByRole('button', { name: 'Remove Anthropic API key' }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove Anthropic API key' }),
      ).not.toBeInTheDocument(),
    )
    expect(getKey('anthropic')).toBeUndefined()
  })

  it('lists only configured providers, and says so when there are none', async () => {
    stubModels(false)
    render(<AiSettings />)
    expect(await screen.findByText(/No providers configured/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Plan model provider' })).toBeNull()
  })

  it('lists a provider once its key is saved, and never Ollama', async () => {
    stubModels(false)
    await unlockedVault()
    await setKey('anthropic', 'k')
    const user = userEvent.setup()
    render(<AiSettings />)
    // A route saved for an unconfigured provider stays listed until it falls back.
    await waitFor(async () =>
      expect((await loadRoutes()).plan.provider).toBe('anthropic'),
    )
    await user.click(await screen.findByRole('combobox', { name: 'Plan model provider' }))
    expect(await screen.findByRole('option', { name: 'Anthropic' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Gemini' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Ollama (local)' })).toBeNull()
  })

  it('moves a stage to a configured provider with its default model', async () => {
    stubModels(false)
    await unlockedVault()
    await setKey('anthropic', 'k')
    render(<AiSettings />)
    await waitFor(async () => {
      const r = await loadRoutes()
      expect(r.plan).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' })
      expect(r.execute).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' })
    })
  })

  it('saves the model name for a stage when the field loses focus', async () => {
    stubModels(true)
    await unlockedVault()
    await setKey('gemini', 'k')
    const user = userEvent.setup()
    render(<AiSettings />)
    const field = await screen.findByLabelText('Edit model name')
    await user.clear(field)
    await user.type(field, 'gemini-pro-latest')
    await user.tab()
    await waitFor(async () =>
      expect((await loadRoutes()).execute.model).toBe('gemini-pro-latest'),
    )
  })

  it('saves the provider for a stage', async () => {
    stubModels(true)
    await unlockedVault()
    await setKey('gemini', 'k')
    await setKey('anthropic', 'k')
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.click(await screen.findByRole('combobox', { name: 'Plan model provider' }))
    await user.click(await screen.findByRole('option', { name: 'Anthropic' }))
    await waitFor(async () =>
      expect((await loadRoutes()).plan.provider).toBe('anthropic'),
    )
  })

  it("switches to the new provider's default model, not the old one", async () => {
    stubModels(true)
    await unlockedVault()
    await setKey('gemini', 'k')
    await setKey('anthropic', 'k')
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.click(await screen.findByRole('combobox', { name: 'Edit model provider' }))
    await user.click(await screen.findByRole('option', { name: 'Anthropic' }))
    await waitFor(async () => {
      const r = (await loadRoutes()).execute
      expect(r).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' })
    })
    expect(screen.getByLabelText('Edit model name')).toHaveValue('claude-sonnet-5-5')
  })

  it("lists the provider's real models and picks one", async () => {
    stubModels(true, ['claude-opus-5-5', 'beta-model'])
    await unlockedVault()
    await setKey('gemini', 'k')
    await setKey('anthropic', 'k')
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.click(await screen.findByRole('combobox', { name: 'Plan model provider' }))
    await user.click(await screen.findByRole('option', { name: 'Anthropic' }))
    const field = screen.getByRole('combobox', { name: 'Plan model name' })
    await user.click(field)
    expect(await screen.findByRole('option', { name: 'claude-opus-5-5' })).toBeVisible()
    await user.clear(field)
    await user.type(field, 'beta')
    expect(await screen.findByRole('option', { name: 'beta-model' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'claude-opus-5-5' })).toBeNull()
    await user.click(screen.getByRole('option', { name: 'beta-model' }))
    await waitFor(async () => expect((await loadRoutes()).plan.model).toBe('beta-model'))
  })

  it('says why the list is empty when the request fails', async () => {
    stubModels(false)
    await unlockedVault()
    await setKey('anthropic', 'k')
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.click(await screen.findByRole('combobox', { name: 'Plan model name' }))
    expect(await screen.findByText(/could not reach the provider/i)).toBeVisible()
  })

  it('refuses a passphrase that was not repeated the same', async () => {
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.type(await screen.findByLabelText('New vault passphrase'), 'one')
    await user.type(screen.getByLabelText('Repeat vault passphrase'), 'two')
    await user.click(screen.getByRole('button', { name: 'Create vault' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(await vaultStatus()).toBe('none')
  })

  it('resets a vault whose passphrase was forgotten', async () => {
    await createVault('forgotten')
    lock()
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.click(await screen.findByRole('button', { name: 'Reset vault…' }))
    await user.click(screen.getByRole('button', { name: 'Delete vault and keys' }))
    expect(await screen.findByLabelText('New vault passphrase')).toBeInTheDocument()
    expect(await vaultStatus()).toBe('none')
  })
})
