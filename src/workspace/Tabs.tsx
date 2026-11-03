import { useAtomValue, useStore } from 'jotai'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { prefersReducedMotion } from '../lib/motion'
import { ALT_KEY_LABEL, MOD_KEY_LABEL } from '../lib/platform'
import {
  clampSlot,
  insertIndex,
  othersToClose,
  rightToClose,
  unpinnedPaths,
} from '../state/tabOps'
import {
  activePathAtom,
  openBuffersAtom,
  snapshotAtom,
  workspaceStatusAtom,
  type OpenBuffer,
} from '../state/workspaceAtoms'
import { GlassPopover, Icon, IconButton, Kbd } from '../ui'
import { basename } from './path'
import { focusEditor, useController } from './useWorkspace'

/** Open buffers as a borderless tab strip, 40 px high (ARCHITECTURE.md §5.8). */
export default function Tabs() {
  const buffers = useAtomValue(openBuffersAtom)
  const active = useAtomValue(activePathAtom)
  const status = useAtomValue(workspaceStatusAtom)
  const snapshot = useAtomValue(snapshotAtom)
  if (status.state === 'loading') {
    // Last session's tabs as static names until the buffers are open.
    if (!snapshot || snapshot.openFiles.length === 0) return null
    return (
      <nav
        aria-label="Open files"
        aria-busy="true"
        className="flex min-w-0 items-center gap-1 overflow-x-auto font-mono text-xs"
      >
        {snapshot.openFiles.map((path) => (
          <span
            key={path}
            title={path}
            className={`flex shrink-0 rounded-md px-2 py-1 motion-safe:animate-pulse ${path === snapshot.activeFile ? 'bg-surface text-text' : 'text-muted'}`}
          >
            {basename(path)}
          </span>
        ))}
      </nav>
    )
  }
  if (buffers.length === 0) return null
  return <TabStrip buffers={buffers} active={active} />
}

type Drag = { from: number; path: string }
type Menu = { path: string; x: number; y: number }

function TabStrip({ buffers, active }: { buffers: OpenBuffer[]; active: string | null }) {
  const store = useStore()
  const controller = useController()
  const list = useRef<HTMLDivElement>(null)
  const tabEls = useRef(new Map<string, HTMLButtonElement>())
  const [drag, setDrag] = useState<Drag | null>(null)
  /** Insert slot under the pointer while dragging (see `slotBounds` in tabOps). */
  const [slot, setSlot] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const n = buffers.length

  useWheelToScroll(list)
  useFlipOnReorder(list, buffers.map((b) => b.path).join('\n'))
  // Keep the active tab inside the scrolled strip.
  useEffect(() => {
    const el = list.current
    const tab = active ? tabEls.current.get(active)?.parentElement : undefined
    if (!el || !tab) return
    const left = tab.offsetLeft
    const right = left + tab.offsetWidth
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (right > el.scrollLeft + el.clientWidth)
      el.scrollLeft = right - el.clientWidth
  }, [active])

  const closeTab = (path: string) => void controller.closeBuffer(path)

  // ---- drag and drop -------------------------------------------------------

  const slotAt = (x: number) => {
    const wraps = list.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? []
    for (let i = 0; i < wraps.length; i++) {
      const r = wraps[i]!.getBoundingClientRect()
      if (x < r.left + r.width / 2) return i
    }
    return wraps.length
  }

  const startDrag = (e: DragEvent<HTMLButtonElement>, from: number, path: string) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', path) // Firefox will not start a drag without data
    setDrag({ from, path })
  }

  const endDrag = () => {
    setDrag(null)
    setSlot(null)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag) return // files or text dragged from outside are not tabs
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setSlot(clampSlot(buffers, drag.from, slotAt(e.clientX)))
  }

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!list.current?.contains(e.relatedTarget as Node | null)) setSlot(null)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!drag) return
    e.preventDefault()
    if (slot !== null) {
      const to = insertIndex(drag.from, slot)
      if (to !== drag.from) controller.reorderTab(drag.from, to)
    }
    endDrag()
  }

  // ---- keyboard, mouse -----------------------------------------------------

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number, path: string) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      setMenu({ path, x: r.left, y: r.bottom })
      return
    }
    const to =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null
    if (to === null || to < 0 || to >= n) return
    e.preventDefault()
    tabEls.current.get(buffers[to]!.path)?.focus()
  }

  const closeMenu = (restoreTo: string | null) => {
    setMenu(null)
    if (restoreTo === null) return
    const el = tabEls.current.get(restoreTo)
    if (el) el.focus()
    else focusEditor(store) // the tab closed as a result of the action
  }

  return (
    <>
      <div
        ref={list}
        role="tablist"
        aria-label="Open files"
        aria-orientation="horizontal"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="relative flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto font-sans text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {buffers.map((b, i) => {
          const isActive = b.path === active
          const name = basename(b.path)
          const dragging = drag?.path === b.path
          // Insert markers only when the drop would actually move the tab.
          const marker =
            drag !== null && slot !== null && insertIndex(drag.from, slot) !== drag.from
          return (
            <div
              key={b.path}
              data-tab={b.path}
              role="presentation"
              onMouseDown={(e: MouseEvent) => {
                if (e.button === 1) e.preventDefault() // no autoscroll on middle-click
              }}
              onAuxClick={(e: MouseEvent) => {
                if (e.button !== 1) return
                e.preventDefault()
                closeTab(b.path)
              }}
              onContextMenu={(e: MouseEvent) => {
                e.preventDefault()
                setMenu({ path: b.path, x: e.clientX, y: e.clientY })
              }}
              className={[
                'group relative flex h-full shrink-0 transition-opacity duration-150 ease-out',
                b.pinned ? 'w-9' : 'min-w-[100px] max-w-[200px]',
                dragging ? 'rounded-md bg-canvas opacity-50 shadow-md' : '',
              ].join(' ')}
            >
              {marker && slot === i && <DropMarker side="left" />}
              {marker && slot === n && i === n - 1 && <DropMarker side="right" />}
              <button
                ref={(el) => {
                  if (el) tabEls.current.set(b.path, el)
                  else tabEls.current.delete(b.path)
                }}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="editor-pane"
                aria-label={b.pinned ? name : undefined}
                tabIndex={isActive ? 0 : -1}
                title={b.path}
                draggable
                onClick={() => void controller.openFile(b.path)}
                onKeyDown={(e) => onTabKey(e, i, b.path)}
                onDragStart={(e) => startDrag(e, i, b.path)}
                onDragEnd={endDrag}
                className={[
                  'flex h-full min-w-0 flex-1 items-center border-b-2 text-left transition-[color,opacity] duration-150 ease-out focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent',
                  b.pinned ? 'justify-center' : 'pr-7 pl-3',
                  isActive
                    ? 'border-accent font-medium text-text'
                    : 'border-transparent text-muted hover:text-text hover:opacity-80',
                ].join(' ')}
              >
                {b.pinned ? (
                  <Icon name="pin" className="size-3.5" />
                ) : (
                  <span className="min-w-0 truncate">{name}</span>
                )}
                {(b.dirty || b.saveError) && (
                  <span
                    role="img"
                    aria-label={b.saveError ? 'save failed' : 'unsaved'}
                    title={
                      b.saveError
                        ? `Save failed. Press ${MOD_KEY_LABEL}+S to retry.`
                        : undefined
                    }
                    className="ml-1.5 size-[5px] shrink-0 rounded-full bg-accent"
                  />
                )}
              </button>
              {!b.pinned && (
                <IconButton
                  label={`Close ${b.path}`}
                  icon="x"
                  size="sm"
                  tabIndex={-1}
                  onClick={() => closeTab(b.path)}
                  className={`absolute top-1/2 right-1 -translate-y-1/2 transition-opacity duration-150 ease-out group-hover:opacity-100 focus-visible:opacity-100 ${isActive ? 'opacity-100' : 'opacity-0'}`}
                />
              )}
            </div>
          )
        })}
      </div>
      {menu && (
        <TabMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          buffers={buffers}
          onDone={closeMenu}
        />
      )}
    </>
  )
}

function DropMarker({ side }: { side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-y-0 w-0.5 bg-accent ${side === 'left' ? 'left-0' : 'right-0'}`}
    />
  )
}

interface MenuItem {
  id: string
  label: string
  hint?: string[]
  disabled?: boolean
  run: () => Promise<void> | void
}

/**
 * Right-click menu for one tab. Keyboard: arrows move, Enter activates, Esc or Tab
 * dismisses and returns focus to the tab. Dismisses on outside press, resize, scroll.
 */
function TabMenu({
  path,
  x,
  y,
  buffers,
  onDone,
}: {
  path: string
  x: number
  y: number
  buffers: readonly OpenBuffer[]
  onDone: (restoreTo: string | null) => void
}) {
  const controller = useController()
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const pinned = buffers.find((b) => b.path === path)?.pinned ?? false

  const items: (MenuItem | 'rule')[] = [
    {
      id: 'close',
      label: 'Close',
      hint: [MOD_KEY_LABEL, ALT_KEY_LABEL, 'W'],
      run: () => controller.closeBuffer(path),
    },
    {
      id: 'others',
      label: 'Close Others',
      disabled: othersToClose(buffers, path).length === 0,
      run: () => controller.closeOthers(path),
    },
    {
      id: 'right',
      label: 'Close to the Right',
      disabled: rightToClose(buffers, path).length === 0,
      run: () => controller.closeToRight(path),
    },
    {
      id: 'all',
      label: 'Close All',
      disabled: unpinnedPaths(buffers).length === 0,
      run: () => controller.closeAll(),
    },
    'rule',
    {
      id: 'pin',
      label: pinned ? 'Unpin Tab' : 'Pin Tab',
      run: () => controller.togglePin(path),
    },
    {
      id: 'copy',
      label: 'Copy Relative Path',
      run: () => controller.copyPath(path),
    },
  ]

  const itemEls = () => [
    ...(box.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ) ?? []),
  ]

  // Keep the popover on screen, measured before paint.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
  }, [x, y])

  useEffect(() => {
    itemEls()[0]?.focus()
  }, [])

  useEffect(() => {
    const onDown = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onDone(null)
    }
    const dismiss = () => onDone(null)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [onDone])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onDone(path)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const els = itemEls()
      const cur = els.indexOf(document.activeElement as HTMLButtonElement)
      const step = e.key === 'ArrowDown' ? 1 : -1
      const next =
        cur < 0 ? (step > 0 ? 0 : els.length - 1) : (cur + step + els.length) % els.length
      els[next]?.focus()
    }
  }

  const choose = (item: MenuItem) => {
    void Promise.resolve(item.run()).finally(() => onDone(path))
  }

  return createPortal(
    <GlassPopover
      ref={box}
      role="menu"
      aria-label="Tab actions"
      onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-52 p-1 font-sans text-sm"
    >
      {items.map((item, k) =>
        item === 'rule' ? (
          <div key={`rule-${k}`} role="separator" className="my-1 border-t border-line" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => choose(item)}
            className="flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left hover:bg-surface focus:bg-surface focus:outline-none disabled:opacity-40"
          >
            <span>{item.label}</span>
            {item.hint && (
              <span className="flex gap-1">
                {item.hint.map((key, j) => (
                  <Kbd key={j}>{key}</Kbd>
                ))}
              </span>
            )}
          </button>
        ),
      )}
    </GlassPopover>,
    document.body,
  )
}

// ---- layout effects --------------------------------------------------------

/** Horizontal overflow: a vertical wheel pans the strip. Native pans pass through. */
function useWheelToScroll(list: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = list.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return // nothing to pan: let the page scroll
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      e.preventDefault() // needs passive: false, which React's onWheel does not allow
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [list])
}

/** Neighbour tabs slide 150 ms ease-out to their new positions after a reorder. */
function useFlipOnReorder(list: RefObject<HTMLDivElement | null>, orderKey: string) {
  const lefts = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const animate = !prefersReducedMotion()
    const next = new Map<string, number>()
    for (const wrap of el.querySelectorAll<HTMLElement>('[data-tab]')) {
      const path = wrap.dataset.tab ?? ''
      const x = wrap.offsetLeft
      next.set(path, x)
      const prev = lefts.current.get(path)
      if (
        animate &&
        prev !== undefined &&
        prev !== x &&
        typeof wrap.animate === 'function'
      ) {
        wrap.animate(
          [{ transform: `translateX(${prev - x}px)` }, { transform: 'translateX(0)' }],
          {
            duration: 150,
            easing: 'ease-out',
          },
        )
      }
    }
    lefts.current = next
  }, [list, orderKey])
}
