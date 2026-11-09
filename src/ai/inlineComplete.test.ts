import { describe, expect, it } from 'vitest'
import type { ProviderAdapter, StreamRequest } from '../providers/types'
import { cleanCompletion, requestCompletion } from './inlineComplete'

function fake(chunks: string[], seen: StreamRequest[] = []) {
  const adapter = {
    id: 'ollama',
    listModels: async () => [],
    async *stream(req: StreamRequest) {
      seen.push(req)
      for (const c of chunks) yield c
    },
  } as unknown as ProviderAdapter
  const resolve = (async () => ({
    adapter,
    route: { provider: 'ollama', model: 'm' },
  })) as never
  return resolve
}

describe('cleanCompletion', () => {
  it('strips code fences and trailing space', () => {
    expect(cleanCompletion('```ts\nfoo(1)\n```')).toBe('foo(1)')
    expect(cleanCompletion('bar  \n')).toBe('bar')
  })
  it('returns null for an empty reply and caps the lines', () => {
    expect(cleanCompletion('  \n ')).toBeNull()
    expect(cleanCompletion('a\nb\nc\nd\ne')).toBe('a\nb\nc')
  })
})

describe('requestCompletion', () => {
  it('sends the cursor marker between prefix and suffix and cleans the reply', async () => {
    const seen: StreamRequest[] = []
    const out = await requestCompletion(
      { prefix: 'const a = ', suffix: '\n' },
      new AbortController().signal,
      fake(['1 +', ' 2'], seen),
    )
    expect(out).toBe('1 + 2')
    expect(seen[0]?.messages[0]?.content).toBe('const a = <CURSOR>\n')
    expect(seen[0]?.temperature).toBe(0)
  })

  it('returns null when aborted, and lets resolve errors through', async () => {
    const ctl = new AbortController()
    ctl.abort()
    expect(
      await requestCompletion({ prefix: 'x', suffix: '' }, ctl.signal, fake(['y'])),
    ).toBeNull()
    await expect(
      requestCompletion(
        { prefix: 'x', suffix: '' },
        new AbortController().signal,
        (async () => {
          throw new Error('vault is locked')
        }) as never,
      ),
    ).rejects.toThrow('locked')
  })
})
