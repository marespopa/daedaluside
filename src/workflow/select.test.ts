import { describe, expect, it } from 'vitest'
import { acceptAll, applyHunks, patchHunks, selectPatches } from './select'
import type { FilePatch } from './types'

const lines = (...l: string[]) => l.join('\n') + '\n'
const base = lines('a', 'b', 'c', 'd', 'e', 'f', 'g')
const content = lines('A', 'b', 'c', 'd', 'e', 'f', 'G', 'h')
const patch: FilePatch = { path: 'x.ts', base, content }

describe('hunk selection', () => {
  it('splits distant edits into separate hunks', () => {
    expect(patchHunks(patch)).toHaveLength(2)
  })

  it('applies a chosen subset, back to front', () => {
    expect(applyHunks(patch, new Set([0]))).toBe(lines('A', 'b', 'c', 'd', 'e', 'f', 'g'))
    expect(applyHunks(patch, new Set([1]))).toBe(
      lines('a', 'b', 'c', 'd', 'e', 'f', 'G', 'h'),
    )
  })

  it('returns the exact new text for all hunks and the old text for none', () => {
    expect(applyHunks(patch, new Set([0, 1]))).toBe(content)
    expect(applyHunks(patch, new Set())).toBe(base)
  })

  it('treats a new file as one hunk', () => {
    const n: FilePatch = { path: 'n.ts', base: null, content: 'hi\n' }
    expect(patchHunks(n)).toHaveLength(1)
    expect(applyHunks(n, new Set([0]))).toBe('hi\n')
  })

  it('keeps CRLF files intact when taking one hunk', () => {
    const crlf = (s: string) => s.replace(/\n/g, '\r\n')
    const p: FilePatch = { path: 'w.ts', base: crlf(base), content: crlf(content) }
    expect(applyHunks(p, new Set([0]))).toBe(
      crlf(lines('A', 'b', 'c', 'd', 'e', 'f', 'g')),
    )
  })

  it('selectPatches drops rejected and unchanged files and keeps new ones', () => {
    const other: FilePatch = { path: 'y.ts', base: 'k\n', content: 'm\n' }
    const added: FilePatch = { path: 'n.ts', base: null, content: 'hi\n' }
    const choice = new Map([
      ['x.ts', new Set([0])],
      ['y.ts', new Set<number>()],
      ['n.ts', new Set([0])],
    ])
    const out = selectPatches([patch, other, added], choice)
    expect(out.map((p) => p.path)).toEqual(['x.ts', 'n.ts'])
    expect(out[0]!.content).toBe(lines('A', 'b', 'c', 'd', 'e', 'f', 'g'))
  })

  it('acceptAll chooses every hunk', () => {
    expect([...acceptAll([patch]).get('x.ts')!]).toEqual([0, 1])
  })
})
