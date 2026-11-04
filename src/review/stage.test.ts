import { describe, expect, it } from 'vitest'
import { computeHunks } from './diff'
import {
  minimalChange,
  replaceLines,
  revertHunkText,
  stageHunkText,
  unstageHunkText,
} from './stage'

const HEAD = 'a\nb\nc\nd\ne\nf\ng\nh\n'
// Hunks against HEAD: b -> B (line 2), f deleted, i added at the end.
const WORK = 'a\nB\nc\nd\ne\ng\nh\ni\n'

describe('replaceLines', () => {
  it('swaps a range, inserts at a gap and deletes', () => {
    expect(replaceLines('a\nb\nc\n', { start: 1, count: 1 }, 'X\nY\n', { start: 0, count: 2 })).toBe(
      'a\nX\nY\nc\n',
    )
    expect(replaceLines('a\nc\n', { start: 1, count: 0 }, 'b\n', { start: 0, count: 1 })).toBe('a\nb\nc\n')
    expect(replaceLines('a\nb\nc\n', { start: 1, count: 1 }, '', { start: 0, count: 0 })).toBe('a\nc\n')
  })

  it('terminates an unterminated last line when appending after it', () => {
    expect(replaceLines('a\nb', { start: 2, count: 0 }, 'c\n', { start: 0, count: 1 })).toBe('a\nb\nc\n')
  })

  it('keeps CRLF endings of untouched lines', () => {
    expect(replaceLines('a\r\nb\r\n', { start: 1, count: 1 }, 'B\n', { start: 0, count: 1 })).toBe('a\r\nB\n')
  })
})

describe('hunk patches against the index', () => {
  const [first, second, third] = computeHunks(HEAD, WORK)

  it('stages one hunk and leaves the others out of the index', () => {
    const idx = stageHunkText(HEAD, WORK, first!)
    expect(idx).toBe('a\nB\nc\nd\ne\nf\ng\nh\n')
    const idx2 = stageHunkText(idx!, WORK, third!)
    expect(idx2).toBe('a\nB\nc\nd\ne\nf\ng\nh\ni\n')
    expect(stageHunkText(idx2!, WORK, second!)).toBe(WORK)
  })

  it('stages against an index that already differs from HEAD', () => {
    const index = 'a\nB\nc\nd\ne\nf\ng\nh\n'
    expect(stageHunkText(index, WORK, second!)).toBe('a\nB\nc\nd\ne\ng\nh\n')
  })

  it('reports an already-staged hunk with null', () => {
    const index = stageHunkText(HEAD, WORK, first!)!
    expect(stageHunkText(index, WORK, first!)).toBeNull()
  })

  it('unstages one hunk of a fully staged file', () => {
    expect(unstageHunkText(HEAD, WORK, second!)).toBe('a\nB\nc\nd\ne\nf\ng\nh\ni\n')
    expect(unstageHunkText(HEAD, WORK, first!)).toBe('a\nb\nc\nd\ne\ng\nh\ni\n')
  })

  it('unstages nothing when the index equals HEAD', () => {
    expect(unstageHunkText(HEAD, HEAD, first!)).toBeNull()
  })

  it('reverts a hunk in the working text', () => {
    expect(revertHunkText(HEAD, WORK, first!)).toBe('a\nb\nc\nd\ne\ng\nh\ni\n')
    expect(revertHunkText(HEAD, WORK, second!)).toBe('a\nB\nc\nd\ne\nf\ng\nh\ni\n')
    expect(revertHunkText(HEAD, WORK, third!)).toBe('a\nB\nc\nd\ne\ng\nh\n')
  })
})

describe('minimalChange', () => {
  it('finds the edited middle', () => {
    expect(minimalChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' })
    expect(minimalChange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' })
    expect(minimalChange('aa', 'aaa')).toEqual({ from: 2, to: 2, insert: 'a' })
  })
})
