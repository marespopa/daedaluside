import { needsKey, PROVIDER_IDS } from '../providers'
import type { ProviderId } from '../providers'

/** Providers that can serve a request right now: a keyed provider needs a saved key. */
export function configuredProviders(saved: readonly string[]): ProviderId[] {
  return PROVIDER_IDS.filter((id) => !needsKey(id) || saved.includes(id))
}
