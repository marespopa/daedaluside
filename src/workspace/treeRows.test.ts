import {
  flattenTree,
  nextEntryIndex,
  revealOffset,
  ROW_HEIGHT,
  visibleRange,
} from './treeRows'
import type { Entry } from './types'

const dir = (path: string): Entry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind: 'dir',
})
const file = (path: string): Entry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind: 'file',
})

/** Children grouped by parent, in the order the tree UI builds them. */
function groups(entries: Entry[]) {
  const m = new Map<string, Entry[]>()
  for (const e of entries) {
    const p = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : ''
    m.set(p, [...(m.get(p) ?? []), e])
  }
  return m
}

const TREE = [
  dir('src'),
  file('src/a.ts'),
  dir('src/lib'),
  file('src/lib/util.ts'),
  file('README.md'),
]

describe('flattenTree', () => {
  it('shows only root rows while folders are collapsed', () => {
    const rows = flattenTree(groups(TREE), new Set(), null)
    expect(rows.map((r) => r.key)).toEqual(['src', 'README.md'])
  })

  it('lists the children of expanded folders right after them, with depth and set info', () => {
    const rows = flattenTree(groups(TREE), new Set(['src', 'src/lib']), null)
    expect(rows.map((r) => r.key)).toEqual([
      'src',
      'src/a.ts',
      'src/lib',
      'src/lib/util.ts',
      'README.md',
    ])
    expect(rows[0]).toMatchObject({ type: 'entry', open: true, posInSet: 1, setSize: 2 })
    expect(rows[1]).toMatchObject({ depth: 1, posInSet: 1, setSize: 2, open: false })
    expect(rows[2]).toMatchObject({ depth: 1, posInSet: 2, setSize: 2, open: true })
    expect(rows[3]).toMatchObject({ depth: 2, posInSet: 1, setSize: 1 })
  })

  it('inserts the name input first inside the folder being named', () => {
    const rows = flattenTree(groups(TREE), new Set(['src']), 'src')
    expect(rows.map((r) => r.key)).toEqual([
      'src',
      'new:src',
      'src/a.ts',
      'src/lib',
      'README.md',
    ])
    expect(rows[1]).toMatchObject({ type: 'new', parent: 'src', depth: 1 })
  })

  it('inserts the name input at the top level for the root', () => {
    const rows = flattenTree(groups(TREE), new Set(), '')
    expect(rows[0]).toMatchObject({ type: 'new', parent: '', depth: 0 })
    expect(rows).toHaveLength(3)
  })

  it('does not show the name input when its folder is collapsed', () => {
    const rows = flattenTree(groups(TREE), new Set(), 'src')
    expect(rows.some((r) => r.type === 'new')).toBe(false)
  })

  it('handles a folder with thousands of children without changing the order', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => file(`f${i}.ts`))
    const rows = flattenTree(groups(many), new Set(), null)
    expect(rows).toHaveLength(20_000)
    expect(rows[19_999]!.key).toBe('f19999.ts')
  })

  it('marks an open folder with no listed children as loading until it is loaded', () => {
    const tree = groups([dir('docs'), file('README.md')])
    const loading = flattenTree(tree, new Set(['docs']), null, new Set(['']))
    expect(loading.map((r) => r.key)).toEqual(['docs', 'note:docs', 'README.md'])
    expect(loading[1]).toMatchObject({ type: 'note', kind: 'loading', depth: 1 })
  })

  it('marks a loaded folder with no children as empty', () => {
    const tree = groups([dir('docs'), file('README.md')])
    const rows = flattenTree(tree, new Set(['docs']), null, new Set(['', 'docs']))
    expect(rows[1]).toMatchObject({ type: 'note', kind: 'empty', depth: 1 })
  })

  it('shows no note for collapsed folders, folders with children, or the folder being named', () => {
    const tree = groups(TREE)
    const loaded = new Set(['', 'src', 'src/lib'])
    expect(
      flattenTree(tree, new Set(['src', 'src/lib']), null, loaded).some(
        (r) => r.type === 'note',
      ),
    ).toBe(false)
    const empty = groups([dir('docs')])
    expect(
      flattenTree(empty, new Set(), null, new Set([''])).some((r) => r.type === 'note'),
    ).toBe(false)
    expect(
      flattenTree(empty, new Set(['docs']), 'docs', new Set(['', 'docs'])).some(
        (r) => r.type === 'note',
      ),
    ).toBe(false)
  })
})

describe('visibleRange', () => {
  it('covers the viewport plus overscan at the top', () => {
    expect(visibleRange(0, 240, 1000, 24, 2)).toEqual({ start: 0, end: 12 })
  })

  it('moves with the scroll position', () => {
    // 2400px down = row 100; 240px viewport = 10 rows; overscan 2.
    expect(visibleRange(2400, 240, 1000, 24, 2)).toEqual({ start: 98, end: 112 })
  })

  it('clamps at the end of the list', () => {
    expect(visibleRange(99999, 240, 50, 24, 2)).toEqual({ start: 50, end: 50 })
    expect(visibleRange(900, 240, 50, 24, 2)).toEqual({ start: 35, end: 49 })
  })

  it('is empty for an empty list', () => {
    expect(visibleRange(0, 480, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('revealOffset', () => {
  it('leaves the scroll alone when the row is already visible', () => {
    expect(revealOffset(5, 0, 240)).toBe(0)
  })

  it('scrolls up to a row above the viewport', () => {
    expect(revealOffset(3, 10 * ROW_HEIGHT, 240)).toBe(3 * ROW_HEIGHT)
  })

  it('scrolls down just far enough to show a row below the viewport', () => {
    // Viewport holds rows 0-9. Row 10 needs the viewport to end at its bottom.
    expect(revealOffset(10, 0, 240)).toBe(11 * ROW_HEIGHT - 240)
  })
})

describe('nextEntryIndex', () => {
  it('skips the name input row', () => {
    const rows = flattenTree(groups(TREE), new Set(['src']), 'src')
    expect(nextEntryIndex(rows, 0, 1)).toBe(2)
    expect(nextEntryIndex(rows, 2, -1)).toBe(0)
  })

  it('returns -1 at either end', () => {
    const rows = flattenTree(groups(TREE), new Set(), null)
    expect(nextEntryIndex(rows, rows.length - 1, 1)).toBe(-1)
    expect(nextEntryIndex(rows, 0, -1)).toBe(-1)
  })
})
