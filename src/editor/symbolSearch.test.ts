import { describe, expect, it } from 'vitest'
import { searchSymbol } from './symbolSearch'

const hit = (path: string, line: number, text: string) => ({
  path,
  line,
  col: 0,
  text,
  start: 0,
})

describe('searchSymbol', () => {
  it('keeps whole-word hits, marks declarations, sorts the active file first', async () => {
    const grep = (
      _q: string,
      onBatch: (h: ReturnType<typeof hit>[]) => void,
      onDone: (t: boolean) => void,
    ) => {
      onBatch([
        hit('b.ts', 2, 'run()'),
        hit('a.ts', 1, 'function run() {'),
        hit('a.ts', 5, 'const runner = 1'),
        hit('c.ts', 3, 'const x = run(1)'),
      ])
      onDone(false)
      return () => {}
    }
    const { result } = searchSymbol(grep, 'run', 'c.ts')
    const r = await result
    expect(r.refs.map((h) => `${h.path}:${h.line}`)).toEqual([
      'c.ts:3',
      'a.ts:1',
      'b.ts:2',
    ])
    expect(r.definitions.map((h) => h.path)).toEqual(['a.ts'])
    expect(r.truncated).toBe(false)
  })
})
