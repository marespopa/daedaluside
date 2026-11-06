import { describe, expect, it } from 'vitest'
import { loadTreeCache, saveTreeCache } from './treeCache'
import type { Entry } from './types'

const e = (path: string): Entry => ({
  path,
  name: path.split('/').pop()!,
  kind: 'file',
  size: 1,
})

describe('treeCache', () => {
  it('returns null before anything is saved', async () => {
    expect(await loadTreeCache('none')).toBeNull()
  })
  it('round-trips a file list per workspace', async () => {
    await saveTreeCache('a', [e('x/y.ts')])
    expect((await loadTreeCache('a'))?.map((f) => f.path)).toEqual(['x/y.ts'])
    expect(await loadTreeCache('b')).toBeNull()
  })
})
