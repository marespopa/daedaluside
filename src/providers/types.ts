export type ProviderId = 'gemini' | 'anthropic' | 'ollama'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface StreamRequest {
  model: string
  system?: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
}

export interface ModelInfo {
  id: string
  label: string
}

/** The standard interface from ARCHITECTURE.md: every provider lists models and streams text. */
export interface ProviderAdapter {
  readonly id: ProviderId
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  /** Yields text chunks as they arrive. Aborting `signal` ends the stream with a `ProviderError('aborted')`. */
  stream(request: StreamRequest, signal?: AbortSignal): AsyncIterable<string>
}

export interface AdapterOptions {
  apiKey?: string
  baseUrl?: string
  fetch?: typeof fetch
}

export type ProviderErrorKind =
  'auth' | 'rate-limit' | 'network' | 'http' | 'aborted' | 'protocol'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly status: number | undefined

  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.status = status
  }
}
