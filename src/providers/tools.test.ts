import { describe, expect, it, vi } from 'vitest'
import { createAnthropic } from './anthropic'
import { createGemini } from './gemini'
import { createOllama } from './ollama'
import type { AgentEvent, AgentRequest, ProviderAdapter } from './types'

function streamFetch(chunks: string[]) {
  const fn = vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        c.close()
      },
    })
    return new Response(body)
  })
  return fn as typeof fn & typeof fetch
}

function sentBody(f: { mock: { calls: Parameters<typeof fetch>[] } }) {
  const init = f.mock.calls[0]?.[1]
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

async function events(p: ProviderAdapter, r: AgentRequest) {
  const out: AgentEvent[] = []
  for await (const e of p.chat!(r)) out.push(e)
  return out
}

const tools = [
  {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
  },
]

/** A user turn, an assistant turn that called a tool, and the tool's result. */
const history: AgentRequest['messages'] = [
  { role: 'user', content: 'open a.ts' },
  {
    role: 'assistant',
    content: 'Reading.',
    calls: [{ id: 'c1', name: 'read_file', args: { path: 'a.ts' }, signature: 'sig' }],
  },
  {
    role: 'tool',
    results: [{ id: 'c1', name: 'read_file', content: 'let a', isError: false }],
  },
]
const req: AgentRequest = { model: 'm', system: 'sys', messages: history, tools }

describe('anthropic tool calls', () => {
  it('joins streamed input fragments into one call and keeps text', async () => {
    const f = streamFetch([
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu1","name":"read_file"}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"pa"}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"th\\":\\"a.ts\\"}"}}\n\n',
      'data: {"type":"content_block_stop","index":1}\n\n',
    ])
    const got = await events(createAnthropic({ apiKey: 'k', fetch: f }), req)
    expect(got).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'call', call: { id: 'tu1', name: 'read_file', args: { path: 'a.ts' } } },
    ])
  })

  it('treats an empty input as no arguments', async () => {
    const f = streamFetch([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"list_files"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
    ])
    const got = await events(createAnthropic({ apiKey: 'k', fetch: f }), req)
    expect(got).toEqual([
      { type: 'call', call: { id: 't', name: 'list_files', args: {} } },
    ])
  })

  it('sends tools, tool_use blocks and tool_result blocks', async () => {
    const f = streamFetch([])
    await events(createAnthropic({ apiKey: 'k', fetch: f }), req)
    const body = sentBody(f)
    expect(body.tools).toEqual([
      {
        name: 'read_file',
        description: 'Read a file',
        input_schema: tools[0]?.parameters,
      },
    ])
    expect(body.messages).toEqual([
      { role: 'user', content: 'open a.ts' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading.' },
          { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.ts' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'let a' }],
      },
    ])
  })
})

describe('gemini tool calls', () => {
  it('yields whole function calls with made-up ids and the thought signature', async () => {
    const f = streamFetch([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"},{"functionCall":{"name":"read_file","args":{"path":"a.ts"}},"thoughtSignature":"s1"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_files"}}]}}]}\n\n',
    ])
    const got = await events(createGemini({ apiKey: 'k', fetch: f }), req)
    expect(got).toEqual([
      { type: 'text', text: 'Hi' },
      {
        type: 'call',
        call: {
          id: 'call-1',
          name: 'read_file',
          args: { path: 'a.ts' },
          signature: 's1',
        },
      },
      { type: 'call', call: { id: 'call-2', name: 'list_files', args: {} } },
    ])
  })

  it('sends declarations, functionCall parts and functionResponse parts', async () => {
    const f = streamFetch([])
    await events(createGemini({ apiKey: 'k', fetch: f }), req)
    const body = sentBody(f)
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'read_file',
            description: 'Read a file',
            parameters: tools[0]?.parameters,
          },
        ],
      },
    ])
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'open a.ts' }] },
      {
        role: 'model',
        parts: [
          { text: 'Reading.' },
          {
            functionCall: { name: 'read_file', args: { path: 'a.ts' } },
            thoughtSignature: 'sig',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'read_file', response: { content: 'let a' } } },
        ],
      },
    ])
  })

  it('reports a failed tool as an error response', async () => {
    const f = streamFetch([])
    await events(createGemini({ apiKey: 'k', fetch: f }), {
      ...req,
      messages: [
        {
          role: 'tool',
          results: [{ id: 'c', name: 'x', content: 'nope', isError: true }],
        },
      ],
    })
    expect(JSON.stringify(sentBody(f).contents)).toContain('"response":{"error":"nope"}')
  })
})

describe('ollama tool calls', () => {
  it('yields tool_calls from the stream', async () => {
    const f = streamFetch([
      '{"message":{"content":"Hi"}}\n{"message":{"content":"","tool_calls":[{"function":{"name":"read_file","arguments":{"path":"a.ts"}}}]}}\n',
    ])
    const got = await events(createOllama({ fetch: f }), req)
    expect(got).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'call', call: { id: 'call-1', name: 'read_file', args: { path: 'a.ts' } } },
    ])
  })

  it('sends function tools, assistant tool_calls and tool-role results', async () => {
    const f = streamFetch([])
    await events(createOllama({ fetch: f }), req)
    const body = sentBody(f)
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: tools[0]?.parameters,
        },
      },
    ])
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'open a.ts' },
      {
        role: 'assistant',
        content: 'Reading.',
        tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }],
      },
      { role: 'tool', tool_name: 'read_file', content: 'let a' },
    ])
  })
})
