import { parseJson, readLines, request } from './http'
import { ProviderError } from './types'
import type { AdapterOptions, ModelInfo, ProviderAdapter, StreamRequest } from './types'

export const OLLAMA_BASE = 'http://localhost:11434'

interface OllamaLine {
  message?: { content?: string }
  error?: string
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
  }
}
