import { useAtom, useAtomValue, useStore } from 'jotai'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  activePathAtom,
  copyStatusAtom,
  deletingPathsAtom,
  fileTreeFocusAtom,
  linkedFolderAtom,
  pendingPathsAtom,
  sidebarOpenAtom,
  treeAtom,
  snapshotAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { Button, ContextMenu, Icon, IconButton, type ContextMenuItem } from '../ui'
import FileFinder from './FileFinder'
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

/** Right-click menu. `parent` is where new files and folders go ('' is the root). */
type TreeMenu = { parent: string; entry: Entry | null; x: number; y: number }

function treeMenuItems(
  parent: string,
  entry: Entry | null,
  startNew: (kind: 'new-file' | 'new-folder', parent: string) => void,
  startRename: (entry: Entry) => void,
  startDelete: (entry: Entry) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { id: 'new-file', label: 'New file', run: () => startNew('new-file', parent) },
    { id: 'new-folder', label: 'New folder', run: () => startNew('new-folder', parent) },
  ]
  if (entry) {
    items.push(
      { id: 'rename', label: 'Rename', run: () => startRename(entry) },
      { id: 'delete', label: 'Delete', run: () => startDelete(entry) },
    )
  }
  return items
}

/**
 * File tree: a floating glass panel over the left of the editor. :Explore or Mod-B opens
 * it; q closes it. The editor keeps its width. Only the rows on screen are rendered.
 */
export default function FileTree() {
  const open = useAtomValue(sidebarOpenAtom)
  return (
    <div className="relative h-full w-0 shrink-0">
      <Sidebar open={open} />
    </div>
  )
}

function Sidebar({ open }: { open: boolean }) {
  const store = useStore()
  const controller = useController()
  const [, setOpen] = useAtom(sidebarOpenAtom)
  const focusRequest = useAtomValue(fileTreeFocusAtom)
  const status = useAtomValue(workspaceStatusAtom)
  const snapshot = useAtomValue(snapshotAtom)
  const link = useAtomValue(linkedFolderAtom)
  const tree = useAtomValue(treeAtom)
  const deleting = useAtomValue(deletingPathsAtom)
  const treeBusy = deleting.size > 0
  const activePath = useAtomValue(activePathAtom)
  const pending = useAtomValue(pendingPathsAtom)
  const copy = useAtomValue(copyStatusAtom)

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [menu, setMenu] = useState<TreeMenu | null>(null)
  const [query, setQuery] = useState('')
  const [seenActive, setSeenActive] = useState<string | null>(null)
  // Virtual list state. `cursor` is the keyboard position; `focusTick` asks for DOM focus
  // to follow it after a keyboard move.
  const [cursor, setCursor] = useState<string | null>(null)
  const [focusTick, setFocusTick] = useState(1)
  const [scrollTop, setScrollTop] = useState(0)
  // Last scroll offset seen. The browser resets a hidden element's scroll, so it is put back.
  const savedScroll = useRef(0)
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
  const searching = query.trim() !== ''
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

  const handledFocusRequest = useRef(0)
  useEffect(() => {
    if (!open || handledFocusRequest.current === focusRequest) return
    handledFocusRequest.current = focusRequest
    setCursor(tabStop)
    setFocusTick((t) => t + 1)
  }, [focusRequest, open, tabStop])

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
    if (treeBusy) return
    if (parent) expand(parent, true)
    setConfirm(null)
    setEditing({ kind, parent })
  }

  /** A file's new entries go next to it, in its folder. A folder's go inside it. */
  const openMenu = (x: number, y: number, entry: Entry | null) => {
    if (treeBusy) return
    const parent = entry ? (entry.kind === 'dir' ? entry.path : dirname(entry.path)) : ''
    setMenu({ parent, entry, x, y })
  }

  const close = () => {
    setOpen(false)
    focusEditor(store)
  }

  // The tree is hidden while searching. Put its scroll offset back when it returns, so
  // the virtual list is rendered at the position the user left it.
  useLayoutEffect(() => {
    if (!searching && scroller.current) scroller.current.scrollTop = savedScroll.current
  }, [searching])

  const focusIndex = (i: number) => {
    const row = rows[i]
    if (row?.type !== 'entry') return
    setSelected(row.key)
    setCursor(row.key)
    reveal(i)
    setFocusTick((t) => t + 1)
  }

  const pendingG = useRef(-Infinity)

  // netrw-style keys, with the arrow-key equivalents kept for accessibility.
  const onRowKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (treeBusy) {
      e.preventDefault()
      return
    }
    if (e.target !== e.currentTarget) return
    const row = rows[index]
    if (row?.type !== 'entry') return
    const { entry } = row
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r') {
      e.preventDefault()
      void controller.refreshWorkspace()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const move = (to: number) => {
      if (to < 0) return
      e.preventDefault()
      focusIndex(to)
    }
    const focusParent = () => {
      const parent = dirname(entry.path)
      if (parent === '') return
      e.preventDefault()
      const j = rows.findIndex((r) => r.type === 'entry' && r.key === parent)
      if (j >= 0) focusIndex(j)
    }

    if (e.key === 'g') {
      e.preventDefault()
      const repeated = e.timeStamp - pendingG.current < 1000
      pendingG.current = repeated ? 0 : e.timeStamp
      if (repeated) move(nextEntryIndex(rows, -1, 1))
      return
    }
    pendingG.current = 0

    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        return move(nextEntryIndex(rows, index, 1))
      case 'k':
      case 'ArrowUp':
        return move(nextEntryIndex(rows, index, -1))
      case 'Home':
        return move(nextEntryIndex(rows, -1, 1))
      case 'G':
      case 'End':
        return move(nextEntryIndex(rows, rows.length, -1))
      case 'Enter':
        e.preventDefault()
        return activate(entry)
      case 'l':
      case 'ArrowRight':
        e.preventDefault()
        if (entry.kind === 'dir') {
          if (!expanded.has(entry.path)) expand(entry.path, true)
        } else void controller.openFile(entry.path)
        return
      case 'h':
      case 'ArrowLeft':
        if (entry.kind === 'dir' && expanded.has(entry.path)) {
          e.preventDefault()
          return expand(entry.path, false)
        }
        return focusParent()
      case '-':
        return focusParent()
      case 'a':
        e.preventDefault()
        return startNew(
          'new-file',
          entry.kind === 'dir' ? entry.path : dirname(entry.path),
        )
      case 'A':
        e.preventDefault()
        return startNew(
          'new-folder',
          entry.kind === 'dir' ? entry.path : dirname(entry.path),
        )
      case 'r':
      case 'F2':
        e.preventDefault()
        return setEditing({ kind: 'rename', path: entry.path })
      case 'd':
      case 'D':
      case 'Delete':
        e.preventDefault()
        return setConfirm(entry.path)
      case 'y':
        e.preventDefault()
        return void controller.copyPath(entry.path)
      case 'Y':
        e.preventDefault()
        return void controller.copyAbsolutePath(entry.path)
      case 'q':
        e.preventDefault()
        return close()
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
    if (treeBusy) return
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
        className={`absolute inset-x-1 ${stack}`}
      >
        <div
          style={{ paddingLeft: row.depth * INDENT + 8 }}
          className={`group/row flex h-full items-center gap-1 rounded-md pr-1 ${isActive ? 'bg-surface' : 'hover:bg-surface/60'}`}
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
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
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
                aria-description={pending.has(entry.path) ? 'Copying' : undefined}
                tabIndex={entry.path === tabStop ? 0 : -1}
                onClick={() => activate(entry)}
                onKeyDown={(e) => onRowKey(e, index)}
                className={`flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${isActive ? 'font-medium text-text' : 'text-muted group-hover/row:text-text'}`}
              >
                <span aria-hidden className="flex w-3 shrink-0 justify-center">
                  {isDir && (
                    <Icon
                      name="chevron-right"
                      className={`size-3 transition-transform duration-150 ${row.open ? 'rotate-90' : ''}`}
                    />
                  )}
                </span>
                <span className="truncate">{entry.name}</span>
                {pending.has(entry.path) && (
                  <span
                    aria-hidden
                    title="Still copying. Opening it copies it first."
                    className="ml-auto size-1.5 shrink-0 rounded-full bg-muted motion-safe:animate-pulse"
                  />
                )}
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
      aria-busy={status.state === 'loading' || treeBusy}
      onContextMenu={(e) => {
        if (treeBusy) {
          e.preventDefault()
          return
        }
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
      aria-hidden={!open}
      inert={!open}
      className={`absolute top-[calc(var(--spacing-header)+0.5rem)] bottom-2 left-2 z-20 flex w-sidebar max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-line/60 bg-surface/80 font-sans text-sm shadow-xl backdrop-blur-xl transition-transform duration-200 ease-out motion-reduce:transition-none ${
        open ? 'translate-x-0' : '-translate-x-[110%]'
      }`}
    >
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-xs font-medium text-muted">Files</span>
      </div>

      {treeBusy && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 px-3 pb-2 text-xs text-muted"
        >
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span>Deleting {[...deleting][0]?.split('/').pop()}…</span>
        </div>
      )}

      {link && (
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 px-3 pb-1 text-xs text-muted">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="folder" className="size-3.5 shrink-0" />
            <span className="truncate" title={link.name}>
              {link.paused ? 'Not connected' : 'Writes to'} {link.name}
            </span>
          </span>
          {link.paused && (
            <Button
              size="xs"
              variant="quiet"
              disabled={treeBusy}
              onClick={() => void controller.reconnectFolder()}
            >
              Reconnect
            </Button>
          )}
        </div>
      )}

      {copy && (
        <div role="status" className="shrink-0 px-3 pb-2">
          <div className="flex items-baseline justify-between text-xs text-muted">
            <span>
              Copying {copy.done.toLocaleString()} of {copy.total.toLocaleString()}
            </span>
            {copy.failed > 0 && (
              <span className="text-diff-remove-fg">{copy.failed} failed</span>
            )}
          </div>
          <div className="mt-1 h-px overflow-hidden bg-line">
            <div
              className="h-full bg-accent transition-[width] duration-300 ease-out"
              style={{ width: `${(copy.done / Math.max(copy.total, 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      <FileFinder
        tree={tree}
        value={query}
        onChange={setQuery}
        onOpen={(path) => void controller.openFile(path)}
        label="Find a file"
        disabled={treeBusy}
        className={searching ? 'min-h-0 flex-1' : 'shrink-0'}
      />

      <div
        ref={scroller}
        onScroll={(e) => {
          savedScroll.current = e.currentTarget.scrollTop
          setScrollTop(e.currentTarget.scrollTop)
        }}
        className={searching ? 'hidden' : 'min-h-0 flex-1 overflow-auto'}
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

      {menu && !treeBusy && (
        <ContextMenu
          label="Tree actions"
          x={menu.x}
          y={menu.y}
          items={treeMenuItems(
            menu.parent,
            menu.entry,
            startNew,
            (entry) => {
              setConfirm(null)
              setEditing({ kind: 'rename', path: entry.path })
            },
            (entry) => {
              setEditing(null)
              setConfirm(entry.path)
            },
          )}
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
