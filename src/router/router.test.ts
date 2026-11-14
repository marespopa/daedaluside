import { beforeEach, describe, expect, it } from 'vitest'
import {
  createVault,
  lock,
  resetVaultForTests,
  setKey,
  VaultLockedError,
} from '../vault/vault'
import { idbPut, openDB, SETTINGS } from '../workspace/db'
import {
  clearRoute,
  EMPTY_ROUTES,
  loadRoutes,
  MissingKeyError,
  MissingModelError,
  resetRoutes,
  resolveStage,
  saveRoute,
} from './router'

beforeEach(() => resetVaultForTests())

async function putRaw(value: unknown) {
  const db = await openDB()
  await idbPut(db, SETTINGS, 'ai:routes', value)
  db.close()
}

describe('routes', () => {
  it('has no model for any stage until one is picked', async () => {
    expect(await loadRoutes()).toEqual({ plan: null, execute: null })
  })

  it('saves one stage and leaves the other unset', async () => {
    await saveRoute('execute', { provider: 'anthropic', model: ' claude-x ' })
    const routes = await loadRoutes()
    expect(routes.execute).toEqual({ provider: 'anthropic', model: 'claude-x' })
    expect(routes.plan).toBeNull()
  })

  it('rejects an invalid route', async () => {
    await expect(
      saveRoute('plan', { provider: 'nope' as never, model: 'm' }),
    ).rejects.toThrow()
    await expect(saveRoute('plan', { provider: 'gemini', model: '  ' })).rejects.toThrow()
  })

  it('leaves a stage unset when its stored record is corrupt', async () => {
    await putRaw({
      plan: { provider: 'bogus', model: 'm' },
      execute: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    })
    const routes = await loadRoutes()
    expect(routes.plan).toBeNull()
    expect(routes.execute).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5' })
  })

  it('clears one stage', async () => {
    await saveRoute('plan', { provider: 'anthropic', model: 'big' })
    await saveRoute('execute', { provider: 'gemini', model: 'small' })
    expect((await clearRoute('plan')).plan).toBeNull()
    expect((await loadRoutes()).execute).toEqual({ provider: 'gemini', model: 'small' })
  })

  it('resets every stage to unset', async () => {
    await saveRoute('plan', { provider: 'anthropic', model: 'big' })
    await resetRoutes()
    expect(await loadRoutes()).toEqual(EMPTY_ROUTES)
  })
})

describe('resolveStage', () => {
  it('ignores a saved Ollama route, which is not offered for now', async () => {
    await putRaw({ execute: { provider: 'ollama', model: 'llama' } })
    expect((await loadRoutes()).execute).toBeNull()
  })

  it('throws MissingModelError when no model was picked', async () => {
    await expect(resolveStage('plan')).rejects.toBeInstanceOf(MissingModelError)
    await expect(resolveStage('plan')).rejects.toThrow(/no model selected/i)
  })

  it('throws VaultLockedError when a keyed provider is used while locked', async () => {
    await saveRoute('plan', { provider: 'gemini', model: 'm' })
    await expect(resolveStage('plan')).rejects.toBeInstanceOf(VaultLockedError)
  })

  it('throws MissingKeyError when the vault has no key for the provider', async () => {
    await saveRoute('plan', { provider: 'gemini', model: 'm' })
    await createVault('p')
    await expect(resolveStage('plan')).rejects.toBeInstanceOf(MissingKeyError)
  })

  it('passes the vault key to the adapter', async () => {
    await saveRoute('plan', { provider: 'gemini', model: 'm' })
    await createVault('p')
    await setKey('gemini', 'SECRET')
    let sent: Headers | undefined
    const fakeFetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent = new Headers(init?.headers)
      return new Response(JSON.stringify({ models: [] }))
    }) as typeof fetch
    const { adapter } = await resolveStage('plan', { fetch: fakeFetch })
    await adapter.listModels()
    expect(sent?.get('x-goog-api-key')).toBe('SECRET')
    lock()
  })
})
