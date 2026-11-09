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
  DEFAULT_ROUTES,
  loadRoutes,
  MissingKeyError,
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
  it('returns defaults when nothing is saved', async () => {
    expect(await loadRoutes()).toEqual(DEFAULT_ROUTES)
  })

  it('saves one stage and keeps the other default', async () => {
    await saveRoute('execute', { provider: 'anthropic', model: ' claude-x ' })
    const routes = await loadRoutes()
    expect(routes.execute).toEqual({ provider: 'anthropic', model: 'claude-x' })
    expect(routes.plan).toEqual(DEFAULT_ROUTES.plan)
  })

  it('rejects an invalid route', async () => {
    await expect(
      saveRoute('plan', { provider: 'nope' as never, model: 'm' }),
    ).rejects.toThrow()
    await expect(saveRoute('plan', { provider: 'gemini', model: '  ' })).rejects.toThrow()
  })

  it('falls back per stage when the stored record is corrupt', async () => {
    await putRaw({
      plan: { provider: 'bogus', model: 'm' },
      execute: { provider: 'ollama', model: 'llama' },
    })
    const routes = await loadRoutes()
    expect(routes.plan).toEqual(DEFAULT_ROUTES.plan)
    expect(routes.execute).toEqual({ provider: 'ollama', model: 'llama' })
  })

  it('resets to defaults', async () => {
    await saveRoute('plan', { provider: 'ollama', model: 'big' })
    await resetRoutes()
    expect(await loadRoutes()).toEqual(DEFAULT_ROUTES)
  })
})

describe('resolveStage', () => {
  it('needs no key for Ollama, even with the vault locked', async () => {
    const { adapter, route } = await resolveStage('execute')
    expect(adapter.id).toBe('ollama')
    expect(route.model).toBe(DEFAULT_ROUTES.execute.model)
  })

  it('throws VaultLockedError when a keyed provider is used while locked', async () => {
    await expect(resolveStage('plan')).rejects.toBeInstanceOf(VaultLockedError)
  })

  it('throws MissingKeyError when the vault has no key for the provider', async () => {
    await createVault('p')
    await expect(resolveStage('plan')).rejects.toBeInstanceOf(MissingKeyError)
  })

  it('passes the vault key to the adapter', async () => {
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
