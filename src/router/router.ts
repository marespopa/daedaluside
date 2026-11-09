import { createProvider, needsKey, PROVIDER_IDS } from '../providers'
import type { ProviderAdapter, ProviderId } from '../providers'
import { getKey } from '../vault/vault'
import { idbGet, idbPut, openDB, SETTINGS } from '../workspace/db'

/** The workflow stages that call a model. REVIEW is human-only. */
export type Stage = 'plan' | 'execute'
export const STAGES: readonly Stage[] = ['plan', 'execute']

export interface Route {
  provider: ProviderId
  model: string
}
export type Routes = Record<Stage, Route>

/** PLAN wants a large context; EXECUTE is many small edits, so a light model fits. */
export const DEFAULT_ROUTES: Routes = {
  plan: { provider: 'gemini', model: 'gemini-flash-latest' },
  execute: { provider: 'gemini', model: 'gemini-flash-latest' },
}

const SETTINGS_KEY = 'ai:routes'

export class MissingKeyError extends Error {
  readonly provider: ProviderId
  constructor(provider: ProviderId) {
    super(`No API key stored for ${provider}`)
    this.name = 'MissingKeyError'
    this.provider = provider
  }
}

function isRoute(v: unknown): v is Route {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.model === 'string' &&
    r.model.trim() !== '' &&
    PROVIDER_IDS.includes(r.provider as ProviderId)
  )
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDB()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

/** Saved routes merged over the defaults. A corrupt or partial record falls back per stage. */
export async function loadRoutes(): Promise<Routes> {
  const saved = await withDb((db) =>
    idbGet<Partial<Record<Stage, unknown>>>(db, SETTINGS, SETTINGS_KEY),
  )
  const out: Routes = {
    plan: { ...DEFAULT_ROUTES.plan },
    execute: { ...DEFAULT_ROUTES.execute },
  }
  for (const stage of STAGES) {
    const r = saved?.[stage]
    if (isRoute(r)) out[stage] = { provider: r.provider, model: r.model.trim() }
  }
  return out
}

export async function saveRoute(stage: Stage, route: Route): Promise<Routes> {
  if (!isRoute(route)) throw new Error('Invalid route')
  const routes = await loadRoutes()
  routes[stage] = { provider: route.provider, model: route.model.trim() }
  await withDb((db) => idbPut(db, SETTINGS, SETTINGS_KEY, routes))
  return routes
}

export async function resetRoutes(): Promise<void> {
  await withDb((db) => idbPut(db, SETTINGS, SETTINGS_KEY, DEFAULT_ROUTES))
}

/**
 * The adapter and model for a stage. Reads the key from the unlocked vault at call time, so it is
 * never held anywhere else. Throws VaultLockedError if locked and MissingKeyError if no key is stored.
 */
export async function resolveStage(
  stage: Stage,
  options: { fetch?: typeof fetch } = {},
): Promise<{ adapter: ProviderAdapter; route: Route }> {
  return resolveRoute((await loadRoutes())[stage], options)
}

/** The adapter for one route, with its key read from the vault (see `resolveStage`). */
export function resolveRoute(
  route: Route,
  options: { fetch?: typeof fetch } = {},
): { adapter: ProviderAdapter; route: Route } {
  let apiKey: string | undefined
  if (needsKey(route.provider)) {
    apiKey = getKey(route.provider)
    if (!apiKey) throw new MissingKeyError(route.provider)
  }
  const adapter = createProvider(route.provider, {
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  return { adapter, route }
}
