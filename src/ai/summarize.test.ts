import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import type { ProviderAdapter } from '../providers'
import { chatMessagesAtom, toAgentMessages } from './chat'
import type { ChatEntry } from './chat'
import { compactResults, SUMMARY_THRESHOLD } from './summarize'

function entries(content: string, name = 'read_file'): ChatEntry[] {
  return [
    { id: 1, role: 'user', content: 'q' },
    {
      id: 2,
      role: 'assistant',
      content: '',
      calls: [
        {
          call: { id: 'c1', name, args: { path: 'a.ts' } },
          result: { id: 'c1', name, content },
        },
      ],
    },
  ]
}

const resolveWith = (stream: ProviderAdapter['stream']) =>
  (async () => ({
    adapter: { id: 'ollama', listModels: async () => [], stream },
    route: { provider: 'ollama', model: 'small' },
  })) as never

describe('compactResults', () => {
  it('replays a summary of a large read in later turns, keeping the raw result', async () => {
    const store = createStore()
    const big = 'x'.repeat(SUMMARY_THRESHOLD + 1)
    store.set(chatMessagesAtom, entries(big))
    await compactResults(
      store,
      resolveWith(async function* () {
        yield 'short '
        yield 'version'
      }),
    )
    const call = store.get(chatMessagesAtom)[1]!.calls![0]!
    expect(call.result!.content).toBe(big)
    expect(call.summary).toBe('short version')
    const tool = toAgentMessages(store.get(chatMessagesAtom)).find(
      (m) => m.role === 'tool',
    )
    expect(tool && 'results' in tool && tool.results[0]!.content).toContain(
      'short version',
    )
  })

  it('leaves small results, edits and failures alone', async () => {
    const store = createStore()
    let used = false
    const resolve = resolveWith(async function* () {
      used = true
      yield 'x'
    })
    store.set(chatMessagesAtom, entries('small'))
    await compactResults(store, resolve)
    store.set(chatMessagesAtom, entries('y'.repeat(SUMMARY_THRESHOLD + 1), 'edit_file'))
    await compactResults(store, resolve)
    expect(used).toBe(false)
  })

  it('keeps the raw result when the summarizer fails', async () => {
    const store = createStore()
    store.set(chatMessagesAtom, entries('z'.repeat(SUMMARY_THRESHOLD + 1)))
    await compactResults(
      store,
      resolveWith(
        // eslint-disable-next-line require-yield
        async function* () {
          throw new Error('down')
        },
      ),
    )
    expect(store.get(chatMessagesAtom)[1]!.calls![0]!.summary).toBeUndefined()
  })
})
