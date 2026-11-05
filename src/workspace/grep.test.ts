import { GrepIndex, shouldIndex, type GrepHit } from './grep'

const never = () => false
async function run(index: GrepIndex, query: string, priority: string[] = []) {
  const hits: GrepHit[] = []
  const r = await index.search(
    { id: 1, query, limit: 500, priority },
    (h) => hits.push(...h),
    never,
  )
  return { hits, ...r }
}

function sample() {
  const i = new GrepIndex()
  i.set('a.ts', 'const one = 1\nconst Two = 2\nlet three = 3\n')
  i.set('b/c.ts', 'nothing here\r\nTWO again\r\n')
  return i
}

describe('GrepIndex', () => {
  it('reports 1-based lines and columns', async () => {
    const { hits } = await run(sample(), 'three')
    expect(hits).toEqual([
      { path: 'a.ts', line: 3, col: 4, text: 'let three = 3', start: 0 },
    ])
  })

  it('ignores case for lowercase queries and respects it otherwise', async () => {
    const i = sample()
    expect((await run(i, 'two')).hits.map((h) => h.path)).toEqual(['a.ts', 'b/c.ts'])
    expect((await run(i, 'Two')).hits.map((h) => h.path)).toEqual(['a.ts'])
  })

  it('drops the CR of CRLF lines', async () => {
    const { hits } = await run(sample(), 'again')
    expect(hits[0]!.text).toBe('TWO again')
    expect(hits[0]!.line).toBe(2)
  })

  it('reports a line once however many matches it has', async () => {
    const i = new GrepIndex()
    i.set('x', 'aa aa aa\nb\naa')
    expect((await run(i, 'aa')).hits.map((h) => h.line)).toEqual([1, 3])
  })

  it('searches priority paths first', async () => {
    const { hits } = await run(sample(), 'two', ['b/c.ts'])
    expect(hits.map((h) => h.path)).toEqual(['b/c.ts', 'a.ts'])
  })

  it('windows very long lines around the match', async () => {
    const i = new GrepIndex()
    i.set('long', `${'x'.repeat(1000)}NEEDLE${'y'.repeat(1000)}`)
    const [h] = (await run(i, 'NEEDLE')).hits
    expect(h!.text.length).toBeLessThanOrEqual(240)
    expect(h!.text.slice(h!.col - h!.start, h!.col - h!.start + 6)).toBe('NEEDLE')
  })

  it('stops at the limit and says so', async () => {
    const i = new GrepIndex()
    for (let n = 0; n < 20; n++) i.set(`f${n}`, 'hit\n')
    const hits: GrepHit[] = []
    const r = await i.search(
      { id: 1, query: 'hit', limit: 5, priority: [] },
      (h) => hits.push(...h),
      never,
    )
    expect(hits).toHaveLength(5)
    expect(r.truncated).toBe(true)
  })

  it('narrows an extended query to the files the last one matched', async () => {
    const i = sample()
    await run(i, 'on')
    // New text that matches "one" lands in the index but not in the narrowed set... until it changes.
    i.set('d', 'one more\n')
    expect((await run(i, 'one')).hits.map((h) => h.path).sort()).toEqual(['a.ts', 'd'])
  })

  it('sees updates and removals', async () => {
    const i = sample()
    i.delete('a.ts')
    i.set('b/c.ts', 'fresh\n')
    expect((await run(i, 'two')).hits).toEqual([])
    expect((await run(i, 'fresh')).hits).toHaveLength(1)
  })

  it('stops when cancelled between slices', async () => {
    const i = new GrepIndex()
    for (let n = 0; n < 2000; n++) i.set(`f${n}`, `${'filler '.repeat(500)}\nhit\n`)
    let calls = 0
    const r = await i.search(
      { id: 1, query: 'hit', limit: 500, priority: [] },
      () => {},
      () => ++calls > 0,
      () => Promise.resolve(),
    )
    expect(r.cancelled).toBe(true)
  })

  it('matches case-insensitively in text whose lowercase form changes length', async () => {
    const i = new GrepIndex()
    i.set('dotted', 'İstanbul and needle\n')
    expect((await run(i, 'needle')).hits).toHaveLength(1)
  })
})

describe('shouldIndex', () => {
  it('skips binaries, svg, empty and oversized files', () => {
    expect(shouldIndex('src/a.ts', 10)).toBe(true)
    expect(shouldIndex('Makefile', undefined)).toBe(true)
    expect(shouldIndex('img/logo.PNG', 10)).toBe(false)
    expect(shouldIndex('icon.svg', 10)).toBe(false)
    expect(shouldIndex('a.ts', 0)).toBe(false)
    expect(shouldIndex('big.ts', 5 * 1024 * 1024)).toBe(false)
    expect(shouldIndex('dir.d/noext', 10)).toBe(true)
  })
})
