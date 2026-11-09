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

/** A function the model may call. `parameters` is a JSON Schema object. */
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  /** Providers without call ids (Gemini, Ollama) get one made up, unique within the stream. */
  id: string
  name: string
  args: Record<string, unknown>
  /** Opaque provider data that must be echoed back with the call (Gemini thought signature). */
  signature?: string
}

export interface ToolResult {
  id: string
  name: string
  content: string
  isError?: boolean
}

/** One turn of an agent conversation: text, the calls the model made, or the results sent back. */
export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; calls?: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] }

export interface AgentRequest {
  model: string
  system?: string
  messages: AgentMessage[]
  tools: ToolDef[]
  maxTokens?: number
  temperature?: number
}

export type AgentEvent = { type: 'text'; text: string } | { type: 'call'; call: ToolCall }

/** The standard interface from ARCHITECTURE.md: every provider lists models and streams text. */
export interface ProviderAdapter {
  readonly id: ProviderId
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  /** Yields text chunks as they arrive. Aborting `signal` ends the stream with a `ProviderError('aborted')`. */
  stream(request: StreamRequest, signal?: AbortSignal): AsyncIterable<string>
  /**
   * Like `stream`, but the model may call tools. Yields text and whole tool calls; the caller
   * runs them and sends the results back in the next request. Absent on test doubles.
   */
  chat?(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>
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
