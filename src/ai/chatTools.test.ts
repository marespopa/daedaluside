import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentRequest, ProviderAdapter } from '../providers'
import { chatMessagesAtom, MAX_STEPS, sendChat, toAgentMessages } from './chat'
import type { ToolHost } from './companionTools'

/** A model that plays back one scripted reply per call and records each request. */
function scripted(replies: AgentEvent[][]) {
  const requests: AgentRequest[] = []
  const adapter: ProviderAdapter = {
    id: 'ollama',
    listModels: async () => [],
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('stream should not be used')
    },
    async *chat(req) {
      requests.push({ ...req, messages: [...req.messages] })
      for (const e of replies[Math.min(requests.length - 1, replies.length - 1)] ?? [])
        yield e
    },
  }
  const resolve = (async () => ({
    adapter,
    route: { provider: 'ollama', model: 'm' },
  })) as never
  return { resolve, requests }
}

function host(files: Record<string, string>) {
  const writes: string[] = []
  const h: ToolHost = {
    tree: async () => [],
    read: async (p) => files[p] ?? null,
    search: async () => ({ hits: [], truncated: false }),
    write: async (p, _b, c) => {
      writes.push(`${p}=${c}`)
      files[p] = c
      return true
    },
  }
  return { h, writes }
}

const call = (id: string, name: string, args: Record<string, unknown>): AgentEvent => ({
  type: 'call',
  call: { id, name, args },
})

describe('sendChat with tools', () => {
  it('runs a tool, feeds the result back, and shows the final answer', async () => {
    const store = createStore()
    const { h, writes } = host({ 'a.ts': 'let a' })
    const { resolve, requests } = scripted([
      [call('1', 'edit_file', { path: 'a.ts', search: 'let a', replace: 'const a' })],
      [{ type: 'text', text: 'Done.' }],
    ])
    await sendChat(store, 'make a const', resolve, h)

    expect(writes).toEqual(['a.ts=const a'])
    expect(requests).toHaveLength(2)
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      results: [{ id: '1', name: 'edit_file', content: 'Edited a.ts.' }],
    })
    const entries = store.get(chatMessagesAtom)
    expect(entries.map((e) => e.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(entries[1]?.calls?.[0]?.result?.content).toBe('Edited a.ts.')
    expect(entries[2]?.content).toBe('Done.')
  })

  it('lets the model recover from a failed tool call', async () => {
    const store = createStore()
    const { h, writes } = host({ 'a.ts': 'x' })
    const { resolve, requests } = scripted([
      [call('1', 'read_file', { path: 'missing.ts' })],
      [{ type: 'text', text: 'It is not there.' }],
    ])
    await sendChat(store, 'read it', resolve, h)
    expect(writes).toEqual([])
    const last = requests[1]?.messages.at(-1)
    expect(last).toMatchObject({ role: 'tool', results: [{ isError: true }] })
    expect(store.get(chatMessagesAtom).at(-1)?.content).toBe('It is not there.')
  })

  it('stops a turn that never finishes calling tools', async () => {
    const store = createStore()
    const { h } = host({})
    const { resolve, requests } = scripted([[call('1', 'list_files', {})]])
    await sendChat(store, 'loop', resolve, h)
    expect(requests).toHaveLength(MAX_STEPS)
    expect(store.get(chatMessagesAtom).at(-1)?.error).toBe(
      `Stopped after ${MAX_STEPS} steps.`,
    )
  })

  it('sends earlier tool use back as history on the next message', async () => {
    const store = createStore()
    const { h } = host({ 'a.ts': 'x' })
    const first = scripted([
      [call('1', 'read_file', { path: 'a.ts' })],
      [{ type: 'text', text: 'ok' }],
    ])
    await sendChat(store, 'one', first.resolve, h)
    const second = scripted([[{ type: 'text', text: 'again' }]])
    await sendChat(store, 'two', second.resolve, h)
    const roles = second.requests[0]?.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant', 'user'])
  })
})

describe('toAgentMessages', () => {
  it('drops calls that never got a result, and failed replies', () => {
    const call = { id: '1', name: 'read_file', args: {} }
    expect(
      toAgentMessages([
        { id: 1, role: 'user', content: 'hi' },
        { id: 2, role: 'assistant', content: '', calls: [{ call }] },
        { id: 3, role: 'assistant', content: 'oops', error: 'x' },
      ]),
    ).toEqual([{ role: 'user', content: 'hi' }])
  })
})
