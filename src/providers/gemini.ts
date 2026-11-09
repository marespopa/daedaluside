import { parseJson, request, sseData } from './http'
import type { AdapterOptions, ModelInfo, ProviderAdapter, StreamRequest } from './types'

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiModel {
  name: string
  displayName?: string
  supportedGenerationMethods?: string[]
}
interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

export function createGemini({
  apiKey = '',
  baseUrl = GEMINI_BASE,
  fetch: f,
}: AdapterOptions = {}): ProviderAdapter {
  const doFetch = f ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const headers = { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }
  return {
    id: 'gemini',
    async listModels(signal) {
      const res = await request(doFetch, `${baseUrl}/models?pageSize=200`, {
        headers,
        signal,
      })
      const body = (await res.json()) as { models?: GeminiModel[] }
      return (body.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m): ModelInfo => ({
          id: m.name.replace(/^models\//, ''),
          label: m.displayName ?? m.name,
        }))
    },
    async *stream(req: StreamRequest, signal) {
      const body = {
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: req.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      }
      const url = `${baseUrl}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`
      const res = await request(doFetch, url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
      for await (const data of sseData(res.body)) {
        const chunk = parseJson(data) as GeminiChunk
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) yield part.text
        }
      }
    },
  }
}
