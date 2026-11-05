import { describe, expect, it } from 'vitest'
import {
  declarationRegex,
  isDeclarationAt,
  isDeclarationLine,
  refRegex,
  symbolAt,
} from './symbols'

describe('symbolAt', () => {
  it('finds the identifier under or just after the caret', () => {
    expect(symbolAt('const fooBar = 1', 8)).toBe('fooBar')
    expect(symbolAt('const fooBar = 1', 6)).toBe('fooBar')
    expect(symbolAt('a $x_1 b', 3)).toBe('$x_1')
  })
  it('returns null on whitespace, punctuation and numbers', () => {
    expect(symbolAt('a  b', 2)).toBeNull()
    expect(symbolAt('x = 123', 5)).toBeNull()
  })
})

describe('refRegex', () => {
  it('matches whole identifiers only', () => {
    const hits = 'foo foobar xfoo foo()'.match(refRegex('foo'))
    expect(hits).toHaveLength(2)
  })
  it('escapes regex characters like $', () => {
    expect('$a + a'.match(refRegex('$a'))).toHaveLength(1)
  })
})

describe('declarations', () => {
  it.each([
    'function run() {',
    'export async function run(a) {',
    'const run = () => 1',
    'export const run = async (a) => a',
    'class run {',
    'interface run {',
    'def run(x):',
    'fn run() {',
    'func run() {',
    '  run(a, b) {',
  ])('detects %s', (line) => {
    expect(isDeclarationLine(line, 'run')).toBe(true)
  })

  it.each(['run()', 'x = run(1)', 'if (run(x)) {', 'return run(2)', '  await run()'])(
    'treats %s as a call site',
    (line) => {
      expect(isDeclarationLine(line, 'run')).toBe(false)
    },
  )

  it('does not match a longer name', () => {
    expect(declarationRegex('run').test('function runner() {')).toBe(false)
  })

  it('classifies by caret position', () => {
    expect(isDeclarationAt('function run() {', 10)).toBe(true)
    expect(isDeclarationAt('x = run()', 5)).toBe(false)
  })
})
