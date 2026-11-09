import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadRoutes } from '../router/router'
import {
  createVault,
  getKey,
  lock,
  resetVaultForTests,
  vaultStatus,
} from '../vault/vault'
import AiSettings from './AiSettings'

beforeEach(() => resetVaultForTests())

describe('AiSettings', () => {
  it('creates a vault, stores a key, and locks again', async () => {
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.type(await screen.findByLabelText('New vault passphrase'), 'hunter2')
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

  it('saves the model name for a stage when the field loses focus', async () => {
    const user = userEvent.setup()
    render(<AiSettings />)
    const field = await screen.findByLabelText('Edit model name')
    await user.clear(field)
    await user.type(field, 'llama3')
    await user.tab()
    await waitFor(async () => expect((await loadRoutes()).execute.model).toBe('llama3'))
  })

  it('saves the provider for a stage', async () => {
    const user = userEvent.setup()
    render(<AiSettings />)
    await user.click(await screen.findByRole('combobox', { name: 'Plan model provider' }))
    await user.click(await screen.findByRole('option', { name: 'Ollama (local)' }))
    await waitFor(async () => expect((await loadRoutes()).plan.provider).toBe('ollama'))
  })
})
