import { useAtom, useAtomValue, useStore } from 'jotai'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  activePathAtom,
  newEntryRequestAtom,
  sidebarOpenAtom,
  treeAtom,
  snapshotAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { Button, ContextMenu, IconButton, type ContextMenuItem } from '../ui'
import NameInput from './NameInput'
import TreeSkeleton from './TreeSkeleton'
import { dirname, joinPath } from './path'
import {
  FALLBACK_VIEWPORT,
  flattenTree,
  INDENT,
  nextEntryIndex,
  revealOffset,
  ROW_HEIGHT,
  type TreeRow,
  visibleRange,
} from './treeRows'
import type { Entry } from './types'
import { focusEditor, useController } from './useWorkspace'

type Editing =
  | { kind: 'new-file' | 'new-folder'; parent: string }
  | { kind: 'rename'; path: string }
  | null

/** Right-click menu. `parent` is the folder a new file or folder goes into ('' is the root). */
type TreeMenu = { parent: string; x: number; y: number }

function treeMenuItems(
  parent: string,
  startNew: (kind: 'new-file' | 'new-folder', parent: string) => void,
): ContextMenuItem[] {
  return [
    { id: 'new-file', label: 'New file', run: () => startNew('new-file', parent) },
    { id: 'new-folder', label: 'New folder', run: () => startNew('new-folder', parent) },
  ]
}

/** File tree overlay, toggled with Mod-B. Only the rows on screen are rendered. */
export default function FileTree() {
  const open = useAtomValue(sidebarOpenAtom)
  return open ? <Sidebar /> : null
}

function Sidebar() {
  const store = useStore()
  const controller = useController()
  const [, setOpen] = useAtom(sidebarOpenAtom)
  const [request, setRequest] = useAtom(newEntryRequestAtom)
  const status = useAtomValue(workspaceStatusAtom)
  const snapshot = useAtomValue(snapshotAtom)
  const tree = useAtomValue(treeAtom)
  const activePath = useAtomValue(activePathAtom)

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [menu, setMenu] = useState<TreeMenu | null>(null)
  const [seenActive, setSeenActive] = useState<string | null>(null)
  // Virtual list state. `cursor` is the keyboard position; `focusTick` asks for DOM focus
  // to follow it after a keyboard move.
  const [cursor, setCursor] = useState<string | null>(null)
  const [focusTick, setFocusTick] = useState(1)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  const root = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Reveal the active file by expanding its ancestors (adjusting state during render).
  if (activePath !== seenActive) {
    setSeenActive(activePath)
    if (activePath) {
      const next = new Set(expanded)
      for (let d = dirname(activePath); d !== ''; d = dirname(d)) next.add(d)
      setExpanded(next)
    }
  }

  const byParent = useMemo(() => {
    const m = new Map<string, Entry[]>()
    for (const e of tree) {
      const p = dirname(e.path)
      const list = m.get(p)
      if (list) list.push(e)
      else m.set(p, [e])
    }
    return m
  }, [tree])

  const kindOf = useMemo(() => new Map(tree.map((e) => [e.path, e.kind])), [tree])

  const newParent = editing && editing.kind !== 'rename' ? editing.parent : null
  const rows = useMemo(
    () => flattenTree(byParent, expanded, newParent),
    [byParent, expanded, newParent],
  )
  const { start, end } = visibleRange(
    scrollTop,
    viewport || FALLBACK_VIEWPORT,
    rows.length,
  )

  // The one row with Tab focus: the cursor if it is visible, else the active file, else the first.
  const tabStop = useMemo(() => {
    const has = (key: string | null) =>
      key !== null && rows.some((r) => r.type === 'entry' && r.key === key)
    if (has(cursor)) return cursor
    if (has(activePath)) return activePath
    return rows.find((r) => r.type === 'entry')?.key ?? null
  }, [rows, cursor, activePath])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setViewport(el.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const focused = useRef(0)
  useEffect(() => {
    if (focused.current === focusTick) return
    focused.current = focusTick
    rowElement(root.current, tabStop)?.focus()
  }, [focusTick, tabStop])

  /** Scrolls so row `index` is fully visible. Sets state too, since jsdom does not scroll. */
  const reveal = (index: number) => {
    const el = scroller.current
    if (!el) return
    const next = revealOffset(index, el.scrollTop, el.clientHeight || FALLBACK_VIEWPORT)
    if (next !== el.scrollTop) {
      el.scrollTop = next
      setScrollTop(next)
    }
  }

  // Keep the active file in view when it changes. Not on every tree refresh.
  useEffect(() => {
    const i = rows.findIndex((r) => r.type === 'entry' && r.key === activePath)
    if (i >= 0) reveal(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath])

  // Bring the name field being created or renamed into view.
  useEffect(() => {
    if (!editing) return
    const key = editing.kind === 'rename' ? editing.path : `new:${editing.parent}`
    const i = rows.findIndex((r) => r.key === key)
    if (i >= 0) reveal(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const expand = (path: string, on: boolean) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (on) n.add(path)
      else n.delete(path)
      return n
    })

  const targetDir = () =>
    selected === '' || kindOf.get(selected) === 'dir' ? selected : dirname(selected)

  const startNew = (kind: 'new-file' | 'new-folder', parent = targetDir()) => {
    if (parent) expand(parent, true)
    setConfirm(null)
    setEditing({ kind, parent })
  }

  const expandAll = () =>
    setExpanded(new Set(tree.filter((e) => e.kind === 'dir').map((e) => e.path)))
  const collapseAll = () => setExpanded(new Set())

  /** A file's new entries go next to it, in its folder. A folder's go inside it. */
  const openMenu = (x: number, y: number, entry: Entry | null) => {
    const parent = entry ? (entry.kind === 'dir' ? entry.path : dirname(entry.path)) : ''
    setMenu({ parent, x, y })
  }

  // New file / New folder from the header: start the inline name field here. The
  // request is a one-shot event from outside the tree, so syncing it into state is
  // the intended use of this effect.
  useEffect(() => {
    if (!request) return
    setRequest(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startNew(request.kind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  const close = () => {
    setOpen(false)
    focusEditor(store)
  }

  const focusIndex = (i: number) => {
    const row = rows[i]
    if (row?.type !== 'entry') return
    setCursor(row.key)
    reveal(i)
    setFocusTick((t) => t + 1)
  }

  // Tree keys follow the WAI-ARIA tree pattern. Only the focused row is a tab stop.
  const onRowKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.target !== e.currentTarget) return
    const row = rows[index]
    if (row?.type !== 'entry') return
    const { entry } = row
    const move = (to: number) => {
      if (to < 0) return
      e.preventDefault()
      focusIndex(to)
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(nextEntryIndex(rows, index, 1))
      case 'ArrowUp':
        return move(nextEntryIndex(rows, index, -1))
      case 'Home':
        return move(nextEntryIndex(rows, -1, 1))
      case 'End':
        return move(nextEntryIndex(rows, rows.length, -1))
      case 'ArrowRight':
        e.preventDefault()
        if (entry.kind === 'dir') {
          if (!expanded.has(entry.path)) expand(entry.path, true)
        } else void controller.openFile(entry.path)
        return
      case 'ArrowLeft': {
        if (entry.kind === 'dir' && expanded.has(entry.path)) {
          e.preventDefault()
          return expand(entry.path, false)
        }
        const parent = dirname(entry.path)
        if (parent === '') return
        e.preventDefault()
        const j = rows.findIndex((r) => r.type === 'entry' && r.key === parent)
        if (j >= 0) focusIndex(j)
        return
      }
      case 'F2':
        e.preventDefault()
        return setEditing({ kind: 'rename', path: entry.path })
      case 'Delete':
        e.preventDefault()
        return setConfirm(entry.path)
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return
        e.preventDefault()
        return openFromRow(entry)
    }
  }

  const openFromRow = (entry: Entry) => {
    const r = rowElement(root.current, entry.path)?.getBoundingClientRect()
    openMenu(r?.left ?? 0, r?.bottom ?? 0, entry)
  }

  const activate = (entry: Entry) => {
    setSelected(entry.path)
    setCursor(entry.path)
    if (entry.kind === 'dir') expand(entry.path, !expanded.has(entry.path))
    else void controller.openFile(entry.path)
  }

  const renderRow = (row: TreeRow, index: number) => {
    const box = { top: index * ROW_HEIGHT, height: ROW_HEIGHT }

    if (row.type === 'new') {
      if (!editing || editing.kind === 'rename') return null
      const { kind, parent } = editing
      return (
        <li key={row.key} role="none" style={box} className="absolute inset-x-0 z-10">
          <div
            style={{ paddingLeft: row.depth * INDENT + 8 }}
            className="flex h-full items-center pr-2"
          >
            <NameInput
              label={kind === 'new-file' ? 'New file name' : 'New folder name'}
              onCancel={() => setEditing(null)}
              onCommit={(name) => {
                setEditing(null)
                const path = joinPath(parent, name)
                void (kind === 'new-file'
                  ? controller.createFile(path)
                  : controller.createFolder(path))
              }}
            />
          </div>
        </li>
      )
    }

    const { entry } = row
    const isDir = entry.kind === 'dir'
    const isActive = entry.path === activePath
    const renaming = editing?.kind === 'rename' && editing.path === entry.path
    const confirming = confirm === entry.path
    // Inline editors can be taller than a row, so they stack above their neighbours.
    const stack = renaming || confirming ? 'z-10' : ''
    return (
      <li
        key={row.key}
        role="treeitem"
        onContextMenu={(e) => {
          e.preventDefault()
          openMenu(e.clientX, e.clientY, entry)
        }}
        aria-level={row.depth + 1}
        aria-setsize={row.setSize}
        aria-posinset={row.posInSet}
        aria-expanded={isDir ? row.open : undefined}
        aria-selected={isActive}
        style={box}
        className={`absolute inset-x-0 ${stack}`}
      >
        <div
          style={{ paddingLeft: row.depth * INDENT + 8 }}
          className={`group/row flex h-full items-center gap-1 pr-2 ${isActive ? 'bg-surface' : ''}`}
        >
          {renaming ? (
            <NameInput
              label={`Rename ${entry.name}`}
              initial={entry.name}
              onCancel={() => setEditing(null)}
              onCommit={(name) => {
                setEditing(null)
                if (name !== entry.name)
                  void controller.renamePath(
                    entry.path,
                    joinPath(dirname(entry.path), name),
                  )
              }}
            />
          ) : confirming ? (
            <>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                Delete {entry.name}?
              </span>
              <Button
                variant="danger"
                size="sm"
                autoFocus
                onClick={() => {
                  setConfirm(null)
                  void controller.deletePath(entry.path)
                }}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-tree-row
                data-row-key={entry.path}
                tabIndex={entry.path === tabStop ? 0 : -1}
                onClick={() => activate(entry)}
                onKeyDown={(e) => onRowKey(e, index)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-0.5 text-left font-mono text-xs hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span aria-hidden className="w-3 shrink-0 text-muted">
                  {isDir ? (row.open ? '▾' : '▸') : isActive ? '•' : ''}
                </span>
                <span className="truncate">{entry.name}</span>
              </button>
              <span className="flex shrink-0 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
                <IconButton
                  size="sm"
                  icon="pencil"
                  label={`Rename ${entry.name}`}
                  onClick={() => setEditing({ kind: 'rename', path: entry.path })}
                />
                <IconButton
                  size="sm"
                  icon="trash"
                  label={`Delete ${entry.name}`}
                  onClick={() => setConfirm(entry.path)}
                />
              </span>
            </>
          )}
        </div>
      </li>
    )
  }

  return (
    <aside
      ref={root}
      aria-label="File tree"
      aria-busy={status.state === 'loading'}
      onContextMenu={(e) => {
        // Rows open their own menu; name fields keep the native one.
        if ((e.target as Element).closest('li[role="treeitem"], input')) return
        e.preventDefault()
        openMenu(e.clientX, e.clientY, null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        }
      }}
      className="glass fixed top-header bottom-0 left-0 z-40 flex w-sidebar max-w-full flex-col border-r border-line font-sans text-sm"
    >
      <div className="flex items-center justify-end gap-0.5 border-b border-line p-1">
        <IconButton
          size="sm"
          icon="expand-all"
          label="Expand all folders"
          disabled={status.state !== 'ready'}
          onClick={expandAll}
        />
        <IconButton
          size="sm"
          icon="collapse-all"
          label="Collapse all folders"
          disabled={status.state !== 'ready'}
          onClick={collapseAll}
        />
      </div>

      <div
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto"
      >
        {status.state === 'loading' &&
          (snapshot ? (
            <TreeSkeleton entries={snapshot.tree} />
          ) : (
            <p className="px-3 py-2 text-muted">Loading…</p>
          ))}
        {status.state === 'error' && (
          <p role="alert" className="px-3 py-2">
            Storage failed to start: {status.message}
          </p>
        )}
        {status.state === 'ready' && (
          <>
            <ul
              role="tree"
              aria-label="Files"
              className="relative"
              style={{ height: rows.length * ROW_HEIGHT }}
            >
              {rows.slice(start, end).map((row, k) => renderRow(row, start + k))}
            </ul>
            {tree.length === 0 && !editing && (
              <p className="px-3 py-2 text-muted">
                Empty folder. Create a file to start.
              </p>
            )}
          </>
        )}
      </div>

      {menu && (
        <ContextMenu
          label="Tree actions"
          x={menu.x}
          y={menu.y}
          items={treeMenuItems(menu.parent, startNew)}
          onDone={(restoreFocus) => {
            setMenu(null)
            if (restoreFocus) rowElement(root.current, tabStop)?.focus()
          }}
        />
      )}
    </aside>
  )
}

function rowElement(container: HTMLElement | null, key: string | null) {
  if (!container || key === null) return undefined
  return [...container.querySelectorAll<HTMLElement>('[data-tree-row]')].find(
    (el) => el.dataset.rowKey === key,
  )
}
