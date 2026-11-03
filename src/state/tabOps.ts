/**
 * Pure tab-strip rules (tab bar PRD §5). No Jotai, no DOM, so they are unit-tested
 * directly. Pinned tabs always form a prefix of the list.
 */

export interface TabRef {
  path: string
  pinned: boolean
}

export interface TabState {
  tabs: TabRef[]
  active: string | null
}

const pinnedCount = (tabs: readonly TabRef[]) => tabs.filter((t) => t.pinned).length

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/** Adds the tab at the end of the unpinned group if absent, then makes it active. */
export function openTab(state: TabState, path: string): TabState {
  const tabs = state.tabs.some((t) => t.path === path)
    ? state.tabs
    : [...state.tabs, { path, pinned: false }]
  return { tabs, active: path }
}

/**
 * Removes the given tabs. If the active tab is removed, `prefer` wins when it survives
 * (used by "Close Others"); otherwise the nearest surviving tab to the right becomes
 * active, falling back to the nearest on the left, then null.
 */
export function removeTabs(
  state: TabState,
  paths: readonly string[],
  prefer?: string,
): TabState {
  const gone = new Set(paths)
  const tabs = state.tabs.filter((t) => !gone.has(t.path))
  const active = state.active
  if (active === null || !gone.has(active)) return { tabs, active }
  if (prefer !== undefined && tabs.some((t) => t.path === prefer))
    return { tabs, active: prefer }
  const i = state.tabs.findIndex((t) => t.path === active)
  const right = state.tabs.slice(i + 1).find((t) => !gone.has(t.path))
  const left = state.tabs
    .slice(0, i)
    .reverse()
    .find((t) => !gone.has(t.path))
  return { tabs, active: (right ?? left)?.path ?? null }
}

/**
 * The tab `delta` places away from the active one, wrapping at both ends. With no
 * active tab, forward goes to the first and back goes to the last. Null when empty.
 */
export function nextTab(state: TabState, delta: 1 | -1): string | null {
  const n = state.tabs.length
  if (n === 0) return null
  const i = state.tabs.findIndex((t) => t.path === state.active)
  const from = i < 0 ? (delta > 0 ? -1 : 0) : i
  return state.tabs[(from + delta + n) % n]!.path
}

/** Unpinned tabs other than `path`. Pinned tabs survive "Close Others". */
export function othersToClose(tabs: readonly TabRef[], path: string): string[] {
  return tabs.filter((t) => t.path !== path && !t.pinned).map((t) => t.path)
}

/** Unpinned tabs to the right of `path`. */
export function rightToClose(tabs: readonly TabRef[], path: string): string[] {
  const i = tabs.findIndex((t) => t.path === path)
  if (i < 0) return []
  return tabs
    .slice(i + 1)
    .filter((t) => !t.pinned)
    .map((t) => t.path)
}

/** Every unpinned tab. "Close All" leaves pinned tabs open. */
export function unpinnedPaths(tabs: readonly TabRef[]): string[] {
  return tabs.filter((t) => !t.pinned).map((t) => t.path)
}

/**
 * Inclusive range of insert slots a dragged tab may land in. A slot is a gap between
 * tabs, numbered 0..length (slot i sits before tab i). Pinned tabs stay in the pinned
 * group and unpinned tabs stay after it.
 */
export function slotBounds(tabs: readonly TabRef[], index: number): [number, number] {
  const pinned = pinnedCount(tabs)
  const item = tabs[index]
  if (!item) return [0, 0]
  return item.pinned ? [0, pinned] : [pinned, tabs.length]
}

export function clampSlot(tabs: readonly TabRef[], from: number, slot: number): number {
  const [lo, hi] = slotBounds(tabs, from)
  return clamp(slot, lo, hi)
}

/** Converts an insert slot (in the list as it is now) to the item's index after the move. */
export function insertIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot
}

/** Moves the tab at `from` to final index `to`, clamped to its pinned or unpinned group. */
export function reorderTabs(tabs: readonly TabRef[], from: number, to: number): TabRef[] {
  const item = tabs[from]
  if (!item) return [...tabs]
  const [lo, hi] = slotBounds(tabs, from)
  // A final index sits between the same bounds as a slot minus one for the removed item.
  const target = clamp(to, lo, hi - 1)
  if (target === from) return [...tabs]
  const next = [...tabs]
  next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

/** Keyboard move by `delta` positions, clamped to the group. */
export function moveTab(tabs: readonly TabRef[], path: string, delta: number): TabRef[] {
  const i = tabs.findIndex((t) => t.path === path)
  if (i < 0) return [...tabs]
  return reorderTabs(tabs, i, i + delta)
}

/**
 * Toggles the pin. A newly pinned tab goes to the end of the pinned group; a newly
 * unpinned tab goes to the start of the unpinned group.
 */
export function togglePin(tabs: readonly TabRef[], path: string): TabRef[] {
  const i = tabs.findIndex((t) => t.path === path)
  if (i < 0) return [...tabs]
  const item = { ...tabs[i]!, pinned: !tabs[i]!.pinned }
  const rest = tabs.filter((_, j) => j !== i)
  const at = pinnedCount(rest)
  return [...rest.slice(0, at), item, ...rest.slice(at)]
}

/** Stable: pinned tabs first, each group keeps its order. */
export function partitionPinned(tabs: readonly TabRef[]): TabRef[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]
}
