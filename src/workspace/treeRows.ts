import type { Entry } from './types'

/** Fixed row height in px. The virtual list positions rows by index, so every row must match. */
export const ROW_HEIGHT = 28
/** Indent per tree level in px. */
export const INDENT = 12
/** Rows rendered beyond the visible window, so fast scrolling does not show blank space. */
export const OVERSCAN = 8
/** Used until the scroll container has been measured (and in environments with no layout). */
export const FALLBACK_VIEWPORT = 480

export type TreeRow =
  | {
      type: 'entry'
      /** Unique within the tree: the entry's workspace path. */
      key: string
      entry: Entry
      depth: number
      /** 1-based position among its siblings, for aria-posinset. */
      posInSet: number
      setSize: number
      open: boolean
    }
  | {
      /**
       * Inside an open folder with no children listed: `loading` until its listing arrives,
       * then `empty`, so a folder still being read is not mistaken for an empty one.
       */
      type: 'note'
      key: string
      kind: 'loading' | 'empty'
      depth: number
    }
  | {
      type: 'new'
      /** Parent directory the new name will be created in. */
      key: string
      parent: string
      depth: number
    }

/**
 * The rows that are on screen once every expanded directory is open, in display
 * order. `newParent` puts an input row first inside that directory (or at the top
 * for the root `''`) while a file or folder is being named. It only appears if
 * that directory is itself visible.
 */
export function flattenTree(
  byParent: ReadonlyMap<string, readonly Entry[]>,
  expanded: ReadonlySet<string>,
  newParent: string | null,
  /** Folders whose children are known. Omit to show no loading or empty notes. */
  loaded?: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const visit = (dir: string, depth: number) => {
    if (dir === newParent)
      rows.push({ type: 'new', key: `new:${dir}`, parent: dir, depth })
    const kids = byParent.get(dir) ?? []
    if (loaded && dir !== '' && kids.length === 0 && dir !== newParent) {
      rows.push({
        type: 'note',
        key: `note:${dir}`,
        kind: loaded.has(dir) ? 'empty' : 'loading',
        depth,
      })
    }
    kids.forEach((entry, i) => {
      const open = entry.kind === 'dir' && expanded.has(entry.path)
      rows.push({
        type: 'entry',
        key: entry.path,
        entry,
        depth,
        posInSet: i + 1,
        setSize: kids.length,
        open,
      })
      if (open) visit(entry.path, depth + 1)
    })
  }
  visit('', 0)
  return rows
}

/** Half-open index range `[start, end)` of rows to render for the given scroll position. */
export function visibleRange(
  scrollTop: number,
  viewport: number,
  count: number,
  rowHeight = ROW_HEIGHT,
  overscan = OVERSCAN,
): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const rows = Math.ceil(Math.max(0, viewport) / rowHeight)
  const start = Math.min(Math.max(0, first - overscan), count)
  const end = Math.min(count, first + rows + overscan)
  return { start, end: Math.max(start, end) }
}

/** The scrollTop that brings row `index` fully into view, or `scrollTop` if it already is. */
export function revealOffset(
  index: number,
  scrollTop: number,
  viewport: number,
  rowHeight = ROW_HEIGHT,
): number {
  const top = index * rowHeight
  const bottom = top + rowHeight
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewport) return bottom - viewport
  return scrollTop
}

/** Index of the next (`step` = 1) or previous (`step` = -1) entry row, or -1. */
export function nextEntryIndex(
  rows: readonly TreeRow[],
  from: number,
  step: 1 | -1,
): number {
  for (let i = from + step; i >= 0 && i < rows.length; i += step) {
    if (rows[i]!.type === 'entry') return i
  }
  return -1
}
