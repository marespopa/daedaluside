import { needsKey, PROVIDER_IDS } from '../providers'
import type { ProviderId } from '../providers'

/** What a stage switches to when its provider changes, so it never keeps another provider's model. */
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-sonnet-5-5',
  ollama: 'qwen2.5-coder',
}

/**
 * Providers that can serve a request right now: a keyed provider needs a saved key, and
 * keyless Ollama needs a reachable local server (merely being listed is not enough).
 */
export function configuredProviders(
  saved: readonly string[],
  ollamaUp: boolean,
): ProviderId[] {
  return PROVIDER_IDS.filter((id) => (needsKey(id) ? saved.includes(id) : ollamaUp))
}

/** The provider and default model a stage falls back to when its own is not configured. */
export function fallbackRoute(
  configured: readonly ProviderId[],
  preferred?: ProviderId,
): { provider: ProviderId; model: string } | null {
  const provider = preferred && configured.includes(preferred) ? preferred : configured[0]
  return provider ? { provider, model: DEFAULT_MODEL[provider] } : null
}
