import { computeHunks, hunkStats, splitLines } from './diff'

describe('splitLines', () => {
  it('ignores a final newline and CRLF', () => {
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
    expect(splitLines('a\n\n')).toEqual(['a', ''])
  })
})

describe('computeHunks', () => {
  it('is empty for identical text, including line endings', () => {
    expect(computeHunks('a\nb\n', 'a\r\nb')).toEqual([])
  })

  it('reports added lines', () => {
    expect(computeHunks('a\nc\n', 'a\nb\nc\n')).toEqual([
      {
        kind: 'add',
        baseRange: { start: 1, count: 0 },
        newRange: { start: 1, count: 1 },
      },
    ])
  })

  it('reports removed lines at the line after the gap', () => {
    expect(computeHunks('a\nb\nc\n', 'a\nc\n')).toEqual([
      {
        kind: 'remove',
        baseRange: { start: 1, count: 1 },
        newRange: { start: 1, count: 0 },
      },
    ])
  })

  it('merges adjacent removed and added lines into one change', () => {
    expect(computeHunks('a\nb\nc\nd\n', 'a\nB1\nB2\nd\n')).toEqual([
      {
        kind: 'change',
        baseRange: { start: 1, count: 2 },
        newRange: { start: 1, count: 2 },
      },
    ])
  })

  it('splits hunks separated by unchanged lines, in order', () => {
    const h = computeHunks('1\n2\n3\n4\n5\n', 'x\n2\n3\n4\ny\n')
    expect(h.map((x) => [x.kind, x.newRange.start])).toEqual([
      ['change', 0],
      ['change', 4],
    ])
  })

  it('treats a missing base as every line added and an empty current as every line removed', () => {
    expect(computeHunks('', 'a\nb\n')).toEqual([
      {
        kind: 'add',
        baseRange: { start: 0, count: 0 },
        newRange: { start: 0, count: 2 },
      },
    ])
    expect(computeHunks('a\nb\n', '')).toEqual([
      {
        kind: 'remove',
        baseRange: { start: 0, count: 2 },
        newRange: { start: 0, count: 0 },
      },
    ])
  })
})

describe('hunkStats', () => {
  it('counts added and removed lines and hunks', () => {
    const h = computeHunks('a\nb\nc\nd\ne\n', 'a\nB\nc\nd\nE\nF\n')
    expect(hunkStats(h)).toEqual({ added: 3, removed: 2, hunks: 2 })
    expect(hunkStats([])).toEqual({ added: 0, removed: 0, hunks: 0 })
  })
})
