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
import { MOD_KEY_LABEL } from '../lib/platform'
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
import { GlassPopover, IconButton } from '../ui'
import { basename } from './path'
import { focusEditor, useController } from './useWorkspace'

/**
 * The tab row lives in the app header with no surface, border, or shadow of its own.
 */
const FRAME = 'flex min-w-0 flex-1 items-center bg-transparent font-mono text-xs'

/** Open buffers as auto-width text tabs in a horizontally scrollable strip. */
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
        className={`${FRAME} gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      >
        {snapshot.openFiles.map((path) => (
          <span
            key={path}
            title={path}
            className={`flex h-6 shrink-0 items-center whitespace-nowrap border-b-[1.5px] motion-safe:animate-pulse ${path === snapshot.activeFile ? 'border-accent font-medium text-text' : 'border-transparent text-muted opacity-50'}`}
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
  const orderKey = buffers.map((b) => `${b.path}:${b.pinned ? 1 : 0}`).join('\n')

  useWheelToScroll(list)
  useFlipOnReorder(list, orderKey)
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
      <div className={FRAME}>
        <div
          ref={list}
          role="tablist"
          aria-label="Open files"
          aria-orientation="horizontal"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className="relative flex min-w-0 flex-1 items-center gap-4 overflow-x-auto bg-transparent [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                  'group relative flex h-6 shrink-0 transition-opacity duration-150 ease-out',
                  dragging ? 'opacity-50' : '',
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
                    'flex h-full shrink-0 items-center whitespace-nowrap border-b-[1.5px] pr-5 text-left transition-[color,opacity] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-accent',
                    isActive
                      ? 'border-accent font-medium text-text'
                      : 'border-transparent text-muted opacity-50 hover:opacity-80',
                  ].join(' ')}
                >
                  <span>{name}</span>
                  {(b.dirty || b.saveError) && (
                    <span
                      role="img"
                      aria-label={b.saveError ? 'save failed' : 'unsaved'}
                      title={
                        b.saveError
                          ? `Save failed. Press ${MOD_KEY_LABEL}+S to retry.`
                          : undefined
                      }
                      className="ml-1.5 size-1 shrink-0 rounded-full bg-accent"
                    />
                  )}
                </button>
                <IconButton
                  label={`Close ${b.path}`}
                  icon="x"
                  size="xs"
                  variant="quiet"
                  tabIndex={-1}
                  onClick={() => closeTab(b.path)}
                  className={`absolute top-1/2 right-0 -translate-y-1/2 transition-opacity duration-150 ease-out focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 ${isActive ? 'opacity-100' : 'opacity-0'}`}
                />
              </div>
            )
          })}
        </div>
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

  const items: MenuItem[] = [
    {
      id: 'close',
      label: 'Close',
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
      label: 'Close to Right',
      disabled: rightToClose(buffers, path).length === 0,
      run: () => controller.closeToRight(path),
    },
    {
      id: 'all',
      label: 'Close All',
      disabled: unpinnedPaths(buffers).length === 0,
      run: () => controller.closeAll(),
    },
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
      className="fixed z-50 min-w-44 p-1 font-sans text-sm"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => choose(item)}
          className="block w-full whitespace-nowrap rounded-md px-3 py-2 text-left hover:bg-accent/10 focus:bg-accent/10 focus:outline-none disabled:opacity-40"
        >
          <span>{item.label}</span>
        </button>
      ))}
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
          { duration: 150, easing: 'ease-out' },
        )
      }
    }
    lefts.current = next
  }, [list, orderKey])
}
