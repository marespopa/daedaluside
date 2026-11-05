import { useEffect, useId, useRef, useState } from 'react'
import { GlassPopover } from './GlassPopover'
import { Icon } from './Icon'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  id?: string
  'aria-label'?: string
  className?: string
}

/**
 * A dropdown dressed like a secondary Button, with a caret at the end. The list is our
 * own popover (not the platform picker) so it matches the rest of the app. Keyboard:
 * Arrow keys / Home / End move, Enter or Space picks, Escape closes just the list.
 */
export function Select({
  value,
  options,
  onChange,
  id,
  className = '',
  ...aria
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const selected = options.findIndex((o) => o.value === value)
  const current = options[selected] ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const show = () => {
    setActive(Math.max(selected, 0))
    setOpen(true)
  }
  const pick = (i: number) => {
    const o = options[i]
    if (o) onChange(o.value)
    setOpen(false)
    button.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = options.length - 1
    const move = (i: number) => {
      e.preventDefault()
      if (open) setActive(Math.min(last, Math.max(0, i)))
      else show()
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(active + 1)
      case 'ArrowUp':
        return move(active - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(last)
      case 'Enter':
      case ' ':
        e.preventDefault()
        return open ? pick(active) : show()
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation() // closes the list, not an enclosing dialog
          setOpen(false)
        }
        return
      case 'Tab':
        setOpen(false)
    }
  }

  return (
    <span ref={root} className={`relative inline-flex ${className}`}>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={aria['aria-label']}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className="inline-flex h-7 w-full min-w-32 cursor-pointer items-center justify-between gap-2 rounded-md border border-muted bg-canvas px-2.5 font-sans text-xs font-medium whitespace-nowrap text-text transition-colors duration-150 ease-out hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span>{current?.label}</span>
        <Icon name="chevron-down" className="size-3.5 text-muted" />
      </button>
      {open && (
        <GlassPopover
          id={listId}
          role="listbox"
          className="absolute top-full right-0 z-50 mt-1 min-w-full overflow-hidden rounded-lg p-1"
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs whitespace-nowrap ${
                i === active ? 'bg-line/60' : ''
              }`}
            >
              {o.label}
              {o.value === value && <Icon name="check" className="size-3.5" />}
            </div>
          ))}
        </GlassPopover>
      )}
    </span>
  )
}
