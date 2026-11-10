import { describe, expect, it } from 'vitest'
import type { AgentEvent, ProviderAdapter } from '../providers'
import { runLoop } from './agentLoop'

const call = (id: string): AgentEvent => ({
  type: 'call',
  call: { id, name: 'list_files', args: {} },
})

function adapterOf(reply: (n: number) => AgentEvent[], delayMs = 0): ProviderAdapter {
  let n = 0
  return {
    id: 'ollama',
    listModels: async () => [],
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('unused')
    },
    async *chat(_req, signal) {
      const events = reply(++n)
      if (delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delayMs)
          signal?.addEventListener('abort', () => {
            clearTimeout(t)
            reject(new Error('aborted'))
          })
        })
      }
      for (const e of events) yield e
    },
  }
}

const base = {
  model: 'm',
  system: 's',
  tools: [],
  exec: async (c: { id: string; name: string }) => ({
    id: c.id,
    name: c.name,
    content: 'ok',
  }),
}

describe('runLoop', () => {
  it('finishes when the model answers without tools', async () => {
    const r = await runLoop({
      ...base,
      adapter: adapterOf(() => [{ type: 'text', text: 'hi' }]),
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(r).toMatchObject({ stop: 'done', text: 'hi', steps: 1 })
  })

  it('stops at the step budget', async () => {
    const r = await runLoop({
      ...base,
      adapter: adapterOf((n) => [call(String(n))]),
      messages: [],
      budget: { maxSteps: 3 },
    })
    expect(r).toMatchObject({ stop: 'steps', steps: 3 })
  })

  it('stops once tokens used reach the budget, and sums usage', async () => {
    const r = await runLoop({
      ...base,
      adapter: adapterOf((n) => [
        { type: 'usage', inputTokens: 80, outputTokens: 20 },
        call(String(n)),
      ]),
      messages: [],
      budget: { maxTokens: 150 },
    })
    expect(r.stop).toBe('tokens')
    expect(r.usage).toEqual({ inputTokens: 160, outputTokens: 40 })
  })

  it('stops at the time budget even while a request is in flight', async () => {
    const r = await runLoop({
      ...base,
      adapter: adapterOf(() => [{ type: 'text', text: 'late' }], 500),
      messages: [],
      budget: { maxMs: 20 },
    })
    expect(r.stop).toBe('time')
  })

  it('reports an abort from the caller', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const r = await runLoop({
      ...base,
      adapter: adapterOf((n) => [call(String(n))]),
      messages: [],
      signal: ctl.signal,
    })
    expect(r.stop).toBe('aborted')
  })
})
