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
/** A stage has no route until the user picks a model for it. Nothing is chosen for them. */
export type Routes = Record<Stage, Route | null>

export const EMPTY_ROUTES: Routes = { plan: null, execute: null }

export const STAGE_LABEL: Record<Stage, string> = {
  plan: 'Plan model',
  execute: 'Edit model',
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

/** The user has not picked a model for this stage yet. */
export class MissingModelError extends Error {
  readonly stage: Stage
  constructor(stage: Stage) {
    super(`No model selected for the ${STAGE_LABEL[stage]}. Pick one in Configure.`)
    this.name = 'MissingModelError'
    this.stage = stage
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

/** The saved routes. A stage that was never set, or whose record is corrupt, is null. */
export async function loadRoutes(): Promise<Routes> {
  const saved = await withDb((db) =>
    idbGet<Partial<Record<Stage, unknown>>>(db, SETTINGS, SETTINGS_KEY),
  )
  const out: Routes = { ...EMPTY_ROUTES }
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

/** Forgets a stage's model, so the user has to pick one again. */
export async function clearRoute(stage: Stage): Promise<Routes> {
  const routes = await loadRoutes()
  routes[stage] = null
  await withDb((db) => idbPut(db, SETTINGS, SETTINGS_KEY, routes))
  return routes
}

export async function resetRoutes(): Promise<void> {
  await withDb((db) => idbPut(db, SETTINGS, SETTINGS_KEY, EMPTY_ROUTES))
}

/**
 * The adapter and model for a stage. Reads the key from the unlocked vault at call time, so it is
 * never held anywhere else. Throws MissingModelError if no model was picked, VaultLockedError if
 * locked and MissingKeyError if no key is stored.
 */
export async function resolveStage(
  stage: Stage,
  options: { fetch?: typeof fetch } = {},
): Promise<{ adapter: ProviderAdapter; route: Route }> {
  const route = (await loadRoutes())[stage]
  if (!route) throw new MissingModelError(stage)
  return resolveRoute(route, options)
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
