import { parseJson, readLines, request } from './http'
import { ProviderError } from './types'
import type {
  AdapterOptions,
  AgentEvent,
  AgentMessage,
  AgentRequest,
  ModelInfo,
  ProviderAdapter,
  StreamRequest,
} from './types'

export const OLLAMA_BASE = 'http://localhost:11434'

interface OllamaLine {
  message?: {
    content?: string
    tool_calls?: { function?: { name?: string; arguments?: Record<string, unknown> } }[]
  }
  error?: string
}

interface OllamaMessage {
  role: string
  content: string
  tool_name?: string
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
}

function toOllama(m: AgentMessage): OllamaMessage[] {
  if (m.role === 'user') return [{ role: 'user', content: m.content }]
  if (m.role === 'tool') {
    return m.results.map((r) => ({ role: 'tool', tool_name: r.name, content: r.content }))
  }
  return [
    {
      role: 'assistant',
      content: m.content,
      ...(m.calls?.length
        ? {
            tool_calls: m.calls.map((c) => ({
              function: { name: c.name, arguments: c.args },
            })),
          }
        : {}),
    },
  ]
}

/** Local models need no key. Ollama must allow this origin via OLLAMA_ORIGINS. */
export function createOllama({
  baseUrl = OLLAMA_BASE,
  fetch: f,
}: AdapterOptions = {}): ProviderAdapter {
  const doFetch = f ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const headers = { 'content-type': 'application/json' }
  return {
    id: 'ollama',
    async listModels(signal) {
      const res = await request(doFetch, `${baseUrl}/api/tags`, { signal })
      const body = (await res.json()) as { models?: { name: string }[] }
      return (body.models ?? []).map((m): ModelInfo => ({ id: m.name, label: m.name }))
    },
    async *stream(req: StreamRequest, signal) {
      const body = {
        model: req.model,
        stream: true,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          ...req.messages,
        ],
        options: {
          ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      }
      const res = await request(doFetch, `${baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
      for await (const line of readLines(res.body)) {
        if (!line.trim()) continue
        const msg = parseJson(line) as OllamaLine
        if (msg.error) throw new ProviderError('http', msg.error)
        if (msg.message?.content) yield msg.message.content
      }
    },
    async *chat(req: AgentRequest, signal): AsyncGenerator<AgentEvent> {
      const body = {
        model: req.model,
        stream: true,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          ...req.messages.flatMap(toOllama),
        ],
        tools: req.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        options: {
          ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      }
      const res = await request(doFetch, `${baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
      let n = 0
      for await (const line of readLines(res.body)) {
        if (!line.trim()) continue
        const msg = parseJson(line) as OllamaLine
        if (msg.error) throw new ProviderError('http', msg.error)
        if (msg.message?.content) yield { type: 'text', text: msg.message.content }
        for (const c of msg.message?.tool_calls ?? []) {
          if (!c.function?.name) continue
          yield {
            type: 'call',
            call: {
              id: `call-${++n}`,
              name: c.function.name,
              args: c.function.arguments ?? {},
            },
          }
        }
      }
    },
  }
}
