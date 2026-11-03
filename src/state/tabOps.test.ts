import { describe, expect, it } from 'vitest'
import {
  clampSlot,
  insertIndex,
  moveTab,
  openTab,
  othersToClose,
  partitionPinned,
  removeTabs,
  reorderTabs,
  rightToClose,
  togglePin,
  unpinnedPaths,
  type TabRef,
  type TabState,
} from './tabOps'

const t = (path: string, pinned = false): TabRef => ({ path, pinned })
const paths = (tabs: readonly TabRef[]) => tabs.map((x) => x.path)

describe('openTab', () => {
  it('appends an absent tab and makes it active', () => {
    const s = openTab({ tabs: [t('a')], active: 'a' }, 'b')
    expect(paths(s.tabs)).toEqual(['a', 'b'])
    expect(s.active).toBe('b')
  })

  it('only focuses a tab that is already open', () => {
    const s = openTab({ tabs: [t('a'), t('b')], active: 'a' }, 'b')
    expect(paths(s.tabs)).toEqual(['a', 'b'])
    expect(s.active).toBe('b')
  })
})

describe('removeTabs', () => {
  const base = (active: string | null): TabState => ({
    tabs: [t('a'), t('b'), t('c'), t('d')],
    active,
  })

  it('keeps the active tab when a different tab closes', () => {
    const s = removeTabs(base('b'), ['c'])
    expect(paths(s.tabs)).toEqual(['a', 'b', 'd'])
    expect(s.active).toBe('b')
  })

  it('activates the right neighbour when the active tab closes', () => {
    expect(removeTabs(base('b'), ['b']).active).toBe('c')
  })

  it('falls back to the left neighbour when there is no tab to the right', () => {
    expect(removeTabs(base('d'), ['d']).active).toBe('c')
  })

  it('becomes null when the last tab closes', () => {
    const s = removeTabs({ tabs: [t('a')], active: 'a' }, ['a'])
    expect(s).toEqual({ tabs: [], active: null })
  })

  it('uses the preferred tab when the active one closes and the preferred survives', () => {
    expect(removeTabs(base('c'), ['c'], 'a').active).toBe('a')
  })

  it('ignores the preferred tab if it is also closing', () => {
    expect(removeTabs(base('c'), ['c', 'a'], 'a').active).toBe('d')
  })

  it('skips tabs that are closing too when choosing the neighbour', () => {
    expect(removeTabs(base('b'), ['b', 'c']).active).toBe('d')
  })
})

describe('bulk close victims', () => {
  const tabs = [t('a'), t('b', true), t('c'), t('d'), t('e', true)]

  it('Close Others keeps the target and pinned tabs', () => {
    expect(othersToClose(tabs, 'c')).toEqual(['a', 'd'])
  })

  it('Close to the Right skips pinned tabs and stops at the target', () => {
    expect(rightToClose(tabs, 'c')).toEqual(['d'])
    expect(rightToClose(tabs, 'e')).toEqual([])
  })

  it('Close All keeps pinned tabs', () => {
    expect(unpinnedPaths(tabs)).toEqual(['a', 'c', 'd'])
  })

  it('returns nothing for an unknown path', () => {
    expect(rightToClose(tabs, 'zzz')).toEqual([])
  })
})

describe('reorderTabs', () => {
  const tabs = [t('a'), t('b'), t('c'), t('d')]

  it('moves a tab forward and back', () => {
    expect(paths(reorderTabs(tabs, 0, 2))).toEqual(['b', 'c', 'a', 'd'])
    expect(paths(reorderTabs(tabs, 3, 1))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('is a no-op when the target equals the source', () => {
    expect(paths(reorderTabs(tabs, 2, 2))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('never moves an unpinned tab into the pinned group', () => {
    const pinned = [t('p1', true), t('p2', true), t('a'), t('b')]
    expect(paths(reorderTabs(pinned, 3, 0))).toEqual(['p1', 'p2', 'b', 'a'])
  })

  it('never moves a pinned tab out of the pinned group', () => {
    const pinned = [t('p1', true), t('p2', true), t('a'), t('b')]
    expect(paths(reorderTabs(pinned, 0, 3))).toEqual(['p2', 'p1', 'a', 'b'])
  })

  it('ignores an out-of-range source', () => {
    expect(paths(reorderTabs(tabs, 9, 0))).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('drag slots', () => {
  const tabs = [t('p', true), t('a'), t('b')]

  it('clamps a drop slot to the dragged tab group', () => {
    expect(clampSlot(tabs, 1, 0)).toBe(1) // unpinned cannot go before the pinned group
    expect(clampSlot(tabs, 0, 3)).toBe(1) // pinned cannot go past it
    expect(clampSlot(tabs, 2, 3)).toBe(3)
  })

  it('converts a slot to the final index', () => {
    expect(insertIndex(0, 3)).toBe(2) // moving to the end
    expect(insertIndex(2, 1)).toBe(1)
    expect(insertIndex(1, 1)).toBe(1) // dropped on its own position
  })
})

describe('moveTab', () => {
  it('moves by one position and stops at the edges of its group', () => {
    const tabs = [t('p', true), t('a'), t('b')]
    expect(paths(moveTab(tabs, 'a', 1))).toEqual(['p', 'b', 'a'])
    expect(paths(moveTab(tabs, 'a', -1))).toEqual(['p', 'a', 'b'])
    expect(paths(moveTab(tabs, 'p', -1))).toEqual(['p', 'a', 'b'])
  })
})

describe('togglePin', () => {
  it('pins a tab to the end of the pinned group', () => {
    const tabs = [t('p', true), t('a'), t('b')]
    expect(togglePin(tabs, 'b')).toEqual([t('p', true), t('b', true), t('a')])
  })

  it('unpins a tab to the start of the unpinned group', () => {
    const tabs = [t('p1', true), t('p2', true), t('a')]
    expect(togglePin(tabs, 'p1')).toEqual([t('p2', true), t('p1'), t('a')])
  })

  it('keeps pinned tabs as a prefix', () => {
    const tabs = [t('a'), t('b', true), t('c')]
    const next = togglePin(tabs, 'a')
    expect(next.map((x) => x.pinned)).toEqual([true, true, false])
  })
})

describe('partitionPinned', () => {
  it('moves pinned tabs first and keeps each group in order', () => {
    const out = partitionPinned([t('a'), t('p1', true), t('b'), t('p2', true)])
    expect(paths(out)).toEqual(['p1', 'p2', 'a', 'b'])
  })
})
