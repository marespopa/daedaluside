import { describe, expect, it, vi } from 'vitest'
import { createAnthropic } from './anthropic'
import { createGemini } from './gemini'
import { createOllama } from './ollama'
import { PROVIDER_IDS, createProvider, needsKey } from './index'
import { ProviderError } from './types'

/** A fetch that streams `chunks` (split anywhere, to exercise buffering) and records the call. */
/** First recorded call, narrowed (noUncheckedIndexedAccess). */
function firstCall(f: { mock: { calls: Parameters<typeof fetch>[] } }) {
  const call = f.mock.calls[0]
  if (!call?.[1]) throw new Error('fetch was not called with init')
  return { url: call[0], init: call[1] }
}

function streamFetch(chunks: string[], status = 200) {
  const fn = vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        c.close()
      },
    })
    return new Response(body, { status })
  })
  return fn as typeof fn & typeof fetch
}

const jsonFetch = (data: unknown, status = 200) =>
  vi.fn(
    async () => new Response(JSON.stringify(data), { status }),
  ) as unknown as typeof fetch

async function collect(it: AsyncIterable<string>) {
  let out = ''
  for await (const s of it) out += s
  return out
}

const req = {
  model: 'm',
  system: 'sys',
  messages: [{ role: 'user' as const, content: 'hi' }],
}

describe('gemini', () => {
  it('lists only generateContent models', async () => {
    const p = createGemini({
      apiKey: 'k',
      fetch: jsonFetch({
        models: [
          {
            name: 'models/gemini-flash',
            displayName: 'Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    })
    expect(await p.listModels()).toEqual([{ id: 'gemini-flash', label: 'Flash' }])
  })

  it('streams text and sends the key as a header, not in the URL', async () => {
    const f = streamFetch([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\ndata: {"candid',
      'ates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n',
    ])
    const out = await collect(createGemini({ apiKey: 'SECRET', fetch: f }).stream(req))
    expect(out).toBe('Hello')
    const { url, init } = firstCall(f)
    expect(String(url)).not.toContain('SECRET')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET')
    const body = JSON.parse(init.body as string)
    expect(body.systemInstruction.parts[0].text).toBe('sys')
    expect(body.contents[0].role).toBe('user')
  })
})

describe('anthropic', () => {
  it('streams text deltas and ignores other events', async () => {
    const f = streamFetch([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"B"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ])
    expect(await collect(createAnthropic({ apiKey: 'k', fetch: f }).stream(req))).toBe(
      'AB',
    )
    const { init } = firstCall(f)
    expect(
      (init.headers as Record<string, string>)[
        'anthropic-dangerous-direct-browser-access'
      ],
    ).toBe('true')
    expect(JSON.parse(init.body as string).stream).toBe(true)
  })

  it('surfaces an in-stream error event', async () => {
    const f = streamFetch(['data: {"type":"error","error":{"message":"overloaded"}}\n\n'])
    await expect(collect(createAnthropic({ fetch: f }).stream(req))).rejects.toThrow(
      'overloaded',
    )
  })

  it('lists models', async () => {
    const p = createAnthropic({
      fetch: jsonFetch({ data: [{ id: 'x', display_name: 'X' }] }),
    })
    expect(await p.listModels()).toEqual([{ id: 'x', label: 'X' }])
  })
})

describe('ollama', () => {
  it('streams NDJSON split across chunks, with system as a message', async () => {
    const f = streamFetch([
      '{"message":{"content":"he"}}\n{"message":{"con',
      'tent":"llo"}}\n{"done":true}\n',
    ])
    expect(await collect(createOllama({ fetch: f }).stream(req))).toBe('hello')
    const body = JSON.parse(firstCall(f).init.body as string)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
  })

  it('throws on an error line', async () => {
    const f = streamFetch(['{"error":"model not found"}\n'])
    await expect(collect(createOllama({ fetch: f }).stream(req))).rejects.toThrow(
      'model not found',
    )
  })

  it('lists local models', async () => {
    const p = createOllama({ fetch: jsonFetch({ models: [{ name: 'qwen2.5-coder' }] }) })
    expect(await p.listModels()).toEqual([
      { id: 'qwen2.5-coder', label: 'qwen2.5-coder' },
    ])
  })
})

describe('error mapping', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'http'],
  ])('maps HTTP %i to %s without leaking the key', async (status, kind) => {
    const f = streamFetch(['nope'], status)
    const err = await collect(
      createGemini({ apiKey: 'SECRET', fetch: f }).stream(req),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.kind).toBe(kind)
    expect(err.message).not.toContain('SECRET')
  })

  it('maps a network failure', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const err = await createOllama({ fetch: f })
      .listModels()
      .catch((e) => e)
    expect(err.kind).toBe('network')
  })

  it('maps an abort before the response', async () => {
    const ac = new AbortController()
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      ac.abort()
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Response('')
    }) as unknown as typeof fetch
    const err = await collect(createOllama({ fetch: f }).stream(req, ac.signal)).catch(
      (e) => e,
    )
    expect(err.kind).toBe('aborted')
  })

  it('maps an abort mid-stream', async () => {
    const ac = new AbortController()
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"message":{"content":"a"}}\n'))
          init?.signal?.addEventListener('abort', () =>
            c.error(new DOMException('x', 'AbortError')),
          )
        },
      })
      return new Response(body)
    }) as unknown as typeof fetch
    const seen: string[] = []
    const run = async () => {
      for await (const s of createOllama({ fetch: f }).stream(req, ac.signal)) {
        seen.push(s)
        ac.abort()
      }
    }
    const err = await run().catch((e) => e)
    expect(seen).toEqual(['a'])
    expect(err.kind).toBe('aborted')
  })

  it('rejects malformed stream data as a protocol error', async () => {
    const f = streamFetch(['data: {not json\n\n'])
    const err = await collect(createAnthropic({ fetch: f }).stream(req)).catch((e) => e)
    expect(err.kind).toBe('protocol')
  })
})

describe('factory', () => {
  it('builds every provider and only Ollama is keyless', () => {
    for (const id of PROVIDER_IDS) expect(createProvider(id).id).toBe(id)
    expect(PROVIDER_IDS.filter((id) => !needsKey(id))).toEqual(['ollama'])
  })
})
