import { describe, expect, it } from 'vitest'
import { NO_RULES, parseGitignoreDirs, skipsDir } from './ignore'

describe('gitignore directory rules', () => {
  it('reads plain and anchored directory names, skipping globs and negations', () => {
    const r = parseGitignoreDirs('# c\nout/\n/tmp\npkg/gen\n*.log\n!keep\nsrc/**/x\n')
    expect([...r.names]).toEqual(['out'])
    expect([...r.paths]).toEqual(['tmp', 'pkg/gen'])
  })
  it('skips build output by default and honours rules', () => {
    const r = parseGitignoreDirs('out\n/tmp\n')
    expect(skipsDir('dist', 'a/dist', NO_RULES)).toBe(true)
    expect(skipsDir('out', 'a/out', r)).toBe(true)
    expect(skipsDir('tmp', 'tmp', r)).toBe(true)
    expect(skipsDir('tmp', 'a/tmp', r)).toBe(false)
    expect(skipsDir('src', 'src', r)).toBe(false)
  })
})
