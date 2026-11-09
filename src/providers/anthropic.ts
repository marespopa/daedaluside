import { parseJson, request, sseData } from './http'
import { ProviderError } from './types'
import type { AdapterOptions, ModelInfo, ProviderAdapter, StreamRequest } from './types'

export const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'

interface AnthropicEvent {
  type: string
  delta?: { type?: string; text?: string }
  error?: { message?: string }
}

export function createAnthropic({
  apiKey = '',
  baseUrl = ANTHROPIC_BASE,
  fetch: f,
}: AdapterOptions = {}): ProviderAdapter {
  const doFetch = f ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Required for calls straight from a browser; the key never leaves the user's machine.
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  }
  return {
    id: 'anthropic',
    async listModels(signal) {
      const res = await request(doFetch, `${baseUrl}/models?limit=100`, {
        headers,
        signal,
      })
      const body = (await res.json()) as {
        data?: { id: string; display_name?: string }[]
      }
      return (body.data ?? []).map((m): ModelInfo => ({
        id: m.id,
        label: m.display_name ?? m.id,
      }))
    },
    async *stream(req: StreamRequest, signal) {
      const body = {
        model: req.model,
        max_tokens: req.maxTokens ?? 8192,
        stream: true,
        ...(req.system ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: req.messages,
      }
      const res = await request(doFetch, `${baseUrl}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
      for await (const data of sseData(res.body)) {
        const ev = parseJson(data) as AnthropicEvent
        if (ev.type === 'error') {
          throw new ProviderError('http', ev.error?.message ?? 'Provider stream error')
        }
        if (
          ev.type === 'content_block_delta' &&
          ev.delta?.type === 'text_delta' &&
          ev.delta.text
        ) {
          yield ev.delta.text
        }
      }
    },
  }
}
