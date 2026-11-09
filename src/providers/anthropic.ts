import { parseJson, request, sseData } from './http'
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

export const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'

interface AnthropicEvent {
  type: string
  index?: number
  content_block?: { type?: string; id?: string; name?: string }
  delta?: { type?: string; text?: string; partial_json?: string }
  error?: { message?: string }
}

function toAnthropic(m: AgentMessage) {
  if (m.role === 'user') return { role: 'user', content: m.content }
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    }
  }
  return {
    role: 'assistant',
    content: [
      ...(m.content ? [{ type: 'text', text: m.content }] : []),
      ...(m.calls ?? []).map((c) => ({
        type: 'tool_use',
        id: c.id,
        name: c.name,
        input: c.args,
      })),
    ],
  }
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
    async *chat(req: AgentRequest, signal): AsyncGenerator<AgentEvent> {
      const body = {
        model: req.model,
        max_tokens: req.maxTokens ?? 8192,
        stream: true,
        ...(req.system ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        messages: req.messages.map(toAnthropic),
      }
      const res = await request(doFetch, `${baseUrl}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
      // Tool input arrives as JSON fragments per content block; a call is whole at block stop.
      const open = new Map<number, { id: string; name: string; json: string }>()
      for await (const data of sseData(res.body)) {
        const ev = parseJson(data) as AnthropicEvent
        if (ev.type === 'error') {
          throw new ProviderError('http', ev.error?.message ?? 'Provider stream error')
        }
        const at = ev.index ?? -1
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          const { id = '', name = '' } = ev.content_block
          open.set(at, { id, name, json: '' })
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta?.type === 'text_delta' && ev.delta.text) {
            yield { type: 'text', text: ev.delta.text }
          } else if (ev.delta?.type === 'input_json_delta') {
            const block = open.get(at)
            if (block) block.json += ev.delta.partial_json ?? ''
          }
        } else if (ev.type === 'content_block_stop') {
          const block = open.get(at)
          if (!block) continue
          open.delete(at)
          const args = block.json.trim() ? parseJson(block.json) : {}
          yield {
            type: 'call',
            call: {
              id: block.id,
              name: block.name,
              args: args as Record<string, unknown>,
            },
          }
        }
      }
    },
  }
}
