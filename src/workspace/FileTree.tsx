import { useLoadEta } from './loadEstimate'
import { useAtom, useAtomValue, useStore } from 'jotai'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  activePathAtom,
  deletingPathsAtom,
  fileTreeFocusAtom,
  linkedFolderAtom,
  noticeAtom,
  openBuffersAtom,
  sidebarOpenAtom,
  treeAtom,
  loadedDirsAtom,
  treeProgressAtom,
  treeStatusAtom,
  snapshotAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { fileDiffMapAtom, gitHeadAtom, type GitStatus } from '../state/gitAtoms'
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
import { useFolderPicker } from './useFolderPicker'
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
 * File tree: a flush, borderless drawer on the left of the editor. :Explore or Mod-B opens
 * it; q closes it. The editor keeps its width. Only the rows on screen are rendered.
 */
/** Marker colors by git status; full class names so Tailwind sees them. */
const GIT_DOT: Record<GitStatus, string> = {
  modified: 'bg-diff-change-fg',
  added: 'bg-diff-add-fg',
  untracked: 'bg-diff-add-fg',
  deleted: 'bg-diff-remove-fg',
}

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
  const { pick } = useFolderPicker()
  const [, setOpen] = useAtom(sidebarOpenAtom)
  const focusRequest = useAtomValue(fileTreeFocusAtom)
  const status = useAtomValue(workspaceStatusAtom)
  const snapshot = useAtomValue(snapshotAtom)
  const link = useAtomValue(linkedFolderAtom)
  const tree = useAtomValue(treeAtom)
  const treeStatus = useAtomValue(treeStatusAtom)
  const progress = useAtomValue(treeProgressAtom)
  const { eta } = useLoadEta(progress)
  const deleting = useAtomValue(deletingPathsAtom)
  const treeBusy = deleting.size > 0
  const activePath = useAtomValue(activePathAtom)
  const buffers = useAtomValue(openBuffersAtom)
  const git = useAtomValue(gitHeadAtom)
  const diffs = useAtomValue(fileDiffMapAtom)

  const treeReady = treeStatus.state === 'ready'
  /** Only changes (create, rename, delete) wait for a ready tree. Opening files never does. */
  const actionsDisabled = treeBusy || !treeReady
  /** Reading the folder. */
  const treeLoading = treeStatus.state === 'loading' && status.state === 'ready'
  const pendingText = treeBusy
    ? `Deleting ${[...deleting][0]?.split('/').pop()}…`
    : treeLoading
      ? progress && progress.done > 0
        ? progress.total
          ? `Reading files… ${progress.done} / ${Math.max(progress.total, progress.done)}${eta ? ` · ${eta}` : ''}`
          : `Reading files… ${progress.done} files`
        : 'Loading files…'
      : null
  /** 0-100 when the total is known; null for the indeterminate bar. */
  const barPercent =
    treeLoading && !treeBusy && progress?.total
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null

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

  /** Dirty files, and every folder above one (the dot shows on collapsed folders too). */
  const dirty = useMemo(() => {
    const set = new Set<string>()
    for (const b of buffers) {
      if (!b.dirty) continue
      set.add(b.path)
      for (let d = dirname(b.path); d !== ''; d = dirname(d)) set.add(d)
    }
    return set
  }, [buffers])

  /** Files that differ from HEAD, and every folder above one (shown as modified). */
  const changed = useMemo(() => {
    const map = new Map<string, GitStatus>(git.status)
    // A live diff knows about edits before the next status read does.
    for (const path of diffs.keys()) if (!map.has(path)) map.set(path, 'modified')
    for (const [path] of [...map]) {
      for (let d = dirname(path); d !== '' && !map.has(d); d = dirname(d))
        map.set(d, 'modified')
    }
    return map
  }, [git, diffs])

  const kindOf = useMemo(() => new Map(tree.map((e) => [e.path, e.kind])), [tree])

  const newParent = editing && editing.kind !== 'rename' ? editing.parent : null
  const loaded = useAtomValue(loadedDirsAtom)
  const rows = useMemo(
    () => flattenTree(byParent, expanded, newParent, loaded),
    [byParent, expanded, newParent, loaded],
  )
  const searching = query.trim() !== ''
  // A folder lists only its root on open: read a folder's children when it is shown, and
  // the whole tree when the file filter needs every name.
  useEffect(() => {
    for (const d of expanded) if (!loaded.has(d)) void controller.loadDir(d)
    // Also when the tree turns ready: folders expanded while it loaded were skipped.
  }, [expanded, loaded, treeStatus.state, controller])
  useEffect(() => {
    if (searching) void controller.ensureFullTree()
  }, [searching, controller])
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

  /** Opens the folder picker from the tree's no-folder state. */
  const openFolder = async () => {
    try {
      await pick()
    } catch (e) {
      store.set(noticeAtom, {
        kind: 'error',
        text: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const startNew = (kind: 'new-file' | 'new-folder', parent = targetDir()) => {
    if (actionsDisabled) return
    if (parent) expand(parent, true)
    setConfirm(null)
    setEditing({ kind, parent })
  }

  /** A file's new entries go next to it, in its folder. A folder's go inside it. */
  const openMenu = (x: number, y: number, entry: Entry | null) => {
    if (actionsDisabled) return
    const parent = entry ? (entry.kind === 'dir' ? entry.path : dirname(entry.path)) : ''
    setMenu({ parent, entry, x, y })
  }

  /** Opens a file. On a narrow screen the drawer covers the editor, so it closes too. */
  const openFile = (path: string) => {
    void controller.openFile(path)
    if (window.innerWidth < 1024) setOpen(false)
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
        } else openFile(entry.path)
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
        if (actionsDisabled) return
        return setEditing({ kind: 'rename', path: entry.path })
      case 'd':
      case 'D':
      case 'Delete':
        e.preventDefault()
        if (actionsDisabled) return
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
    setSelected(entry.path)
    setCursor(entry.path)
    if (entry.kind === 'dir') expand(entry.path, !expanded.has(entry.path))
    else openFile(entry.path)
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

    if (row.type === 'note') {
      return (
        <li key={row.key} role="none" style={box} className="absolute inset-x-0">
          <div
            style={{ paddingLeft: (row.depth + 1) * INDENT + 8 }}
            className="flex h-full items-center gap-2 pr-2 text-xs text-muted"
          >
            {row.kind === 'loading' ? (
              <>
                <span
                  aria-hidden
                  className="size-2.5 animate-spin rounded-full border border-muted border-t-transparent motion-reduce:animate-none"
                />
                <span role="status">Loading…</span>
              </>
            ) : (
              <span>Empty</span>
            )}
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
          className={`group/row relative flex h-full items-center gap-1 pr-3 ${isActive ? 'bg-surface font-medium text-text' : 'hover:bg-surface/60'}`}
        >
          {Array.from({ length: row.depth }, (_, i) => (
            <span
              key={i}
              aria-hidden
              data-guide
              className="pointer-events-none absolute inset-y-0 w-px bg-line opacity-60"
              style={{ left: i * INDENT + 14 }}
            />
          ))}
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
                tabIndex={entry.path === tabStop ? 0 : -1}
                onClick={() => activate(entry)}
                onKeyDown={(e) => onRowKey(e, index)}
                className={`flex h-full min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${isActive ? 'font-medium text-text' : 'text-muted group-hover/row:text-text'}`}
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
              </button>
              {changed.has(entry.path) && (
                <span
                  aria-label={`Git: ${changed.get(entry.path)}`}
                  role="img"
                  data-git-status={changed.get(entry.path)}
                  className={`absolute top-1/2 right-5 size-1 -translate-y-1/2 rounded-full ${GIT_DOT[changed.get(entry.path)!]}`}
                />
              )}
              {dirty.has(entry.path) && (
                <span
                  aria-label="Unsaved changes"
                  role="img"
                  data-dirty-dot
                  className="absolute top-1/2 right-2 size-1 -translate-y-1/2 rounded-full bg-accent"
                />
              )}
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
      aria-busy={status.state === 'loading' || treeBusy || treeStatus.state === 'loading'}
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
      aria-hidden={!open}
      inert={!open}
      className={`absolute top-0 bottom-0 left-0 z-20 flex w-sidebar-compact max-w-[100vw] flex-col border-r border-line bg-canvas font-sans text-sm transition-transform duration-200 ease-out motion-reduce:transition-none min-[1280px]:w-sidebar ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="group/head relative flex h-9 shrink-0 items-center justify-between gap-1 px-3">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="truncate font-mono text-[11px] uppercase text-muted"
            title={link?.name}
          >
            {link?.name ?? 'Files'}
          </span>
          {pendingText && (
            <span role="status" title={pendingText} className="flex shrink-0">
              <span
                aria-hidden
                className="size-2.5 animate-spin rounded-full border border-muted border-t-transparent"
              />
              <span className="sr-only">{pendingText}</span>
            </span>
          )}
        </span>
        {treeLoading && !treeBusy && (
          <div
            aria-hidden
            data-testid="tree-progress"
            className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-line"
          >
            {barPercent === null ? (
              <div className="h-full w-1/3 animate-pulse bg-accent motion-reduce:animate-none" />
            ) : (
              <div
                data-progress={barPercent}
                className="h-full bg-accent transition-[width] duration-150 motion-reduce:transition-none"
                style={{ width: `${barPercent}%` }}
              />
            )}
          </div>
        )}
        {link?.paused && (
          <Button
            size="xs"
            variant="quiet"
            disabled={treeBusy}
            onClick={() => void controller.reconnectFolder()}
          >
            Reconnect
          </Button>
        )}
        <span className="flex shrink-0 opacity-0 transition-opacity group-focus-within/head:opacity-100 group-hover/head:opacity-100">
          <IconButton
            size="sm"
            icon="file-plus"
            label="New file"
            disabled={actionsDisabled}
            onClick={() => startNew('new-file')}
          />
          <IconButton
            size="sm"
            icon="collapse-all"
            label="Collapse all"
            onClick={() => setExpanded(new Set())}
          />
          <IconButton size="sm" icon="x" label="Close file tree" onClick={close} />
        </span>
      </div>

      <FileFinder
        tree={tree}
        value={query}
        onChange={setQuery}
        onOpen={openFile}
        label="Find a file"
        disabled={!treeReady && tree.length === 0}
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
        {status.state === 'ready' && treeStatus.state === 'no-folder' && (
          <div className="px-3 py-2">
            <p className="text-muted">No folder open</p>
            <Button
              size="sm"
              variant="quiet"
              icon="folder"
              className="mt-2"
              onClick={() => void openFolder()}
            >
              Open folder
            </Button>
          </div>
        )}
        {status.state === 'ready' && treeStatus.state === 'permission' && (
          <p className="px-3 py-2 text-muted">
            Reconnect to see the files in this folder.
          </p>
        )}
        {status.state === 'ready' && treeStatus.state === 'error' && (
          <div className="px-3 py-2">
            <p role="alert" className="text-diff-remove-fg">
              Could not list this folder: {treeStatus.message}
            </p>
            <Button
              size="sm"
              variant="quiet"
              className="mt-2"
              onClick={() => void controller.refreshWorkspace()}
            >
              Retry
            </Button>
          </div>
        )}
        {status.state === 'ready' && (treeReady || treeLoading) && (
          <>
            <ul
              role="tree"
              aria-label="Files"
              className="relative"
              style={{ height: rows.length * ROW_HEIGHT }}
            >
              {rows.slice(start, end).map((row, k) => renderRow(row, start + k))}
            </ul>
            {tree.length === 0 && !editing && treeLoading && (
              <p className="px-3 py-2 text-muted">Loading…</p>
            )}
            {tree.length === 0 && !editing && treeReady && (
              <p className="px-3 py-2 text-muted">
                This folder is empty. Create a file to start.
              </p>
            )}
          </>
        )}
      </div>

      {menu && !actionsDisabled && (
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
