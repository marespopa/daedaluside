import { createAnthropic } from './anthropic'
import { createGemini } from './gemini'
import { createOllama } from './ollama'
import type { AdapterOptions, ProviderAdapter, ProviderId } from './types'

export * from './types'

/**
 * Providers offered in the app. The Ollama adapter stays in the tree but is not offered for now:
 * a saved Ollama route is ignored and falls back to the default.
 */
export const PROVIDER_IDS: readonly ProviderId[] = ['gemini', 'anthropic']

/** Whether the provider needs a key from the vault. */
export const needsKey = (id: ProviderId) => id !== 'ollama'

export function createProvider(
  id: ProviderId,
  options: AdapterOptions = {},
): ProviderAdapter {
  switch (id) {
    case 'gemini':
      return createGemini(options)
    case 'anthropic':
      return createAnthropic(options)
    case 'ollama':
      return createOllama(options)
  }
}
