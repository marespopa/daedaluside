import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { GlassPopover } from './GlassPopover'

export interface ContextMenuItem {
  id: string
  label: string
  disabled?: boolean
  /** Right-aligned hint, e.g. "F12". */
  shortcut?: string
  /** Text shown beside a disabled item (never color alone). */
  note?: string
  /** Draw a divider above this item. */
  separator?: boolean
  run: () => Promise<void> | void
}

/**
 * Right-click menu on the glass surface, at a viewport point. Keyboard: arrows move,
 * Enter activates, Esc or Tab dismisses. `onDone(restoreFocus)` runs after an item is
 * chosen (restoreFocus false) or the menu is dismissed (true when Esc or Tab was used,
 * so focus can return to whatever opened it). Dismisses on outside press, resize, scroll.
 */
export function ContextMenu({
  label,
  x,
  y,
  items,
  onDone,
}: {
  label: string
  x: number
  y: number
  items: ContextMenuItem[]
  onDone: (restoreFocus: boolean) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  const itemEls = () => [
    ...(box.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ) ?? []),
  ]

  // Keep the menu on screen, measured before paint.
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
      if (!box.current?.contains(e.target as Node)) onDone(false)
    }
    const dismiss = () => onDone(false)
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
    // The menu renders in a portal, but keys still bubble through the React tree; a
    // container's own Escape handler (e.g. the file tree's) must not see them.
    e.stopPropagation()
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onDone(true)
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

  const choose = (item: ContextMenuItem) => {
    void Promise.resolve(item.run()).finally(() => onDone(false))
  }

  return createPortal(
    <GlassPopover
      ref={box}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-44 p-1 font-sans text-sm"
    >
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separator && (
            <div role="separator" className="mx-2 my-1 border-t border-line" />
          )}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => choose(item)}
            className="flex w-full items-center justify-between gap-6 whitespace-nowrap rounded-md px-3 py-2 text-left hover:bg-accent/10 focus:bg-accent/10 focus:outline-none disabled:opacity-40"
          >
            <span>{item.label}</span>
            {(item.note ?? item.shortcut) && (
              <span className="text-xs text-muted">{item.note ?? item.shortcut}</span>
            )}
          </button>
        </Fragment>
      ))}
    </GlassPopover>,
    document.body,
  )
}
