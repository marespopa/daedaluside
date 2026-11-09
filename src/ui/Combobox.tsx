import { useId, useLayoutEffect, useRef, useState } from 'react'
import { GlassPopover } from './GlassPopover'
import { Input } from './Input'

export interface ComboboxProps {
  value: string
  options: readonly string[]
  /** Called with the final text when the user picks an option, presses Enter or leaves the field. */
  onCommit: (value: string) => void
  /** Shown in the list when there is nothing to suggest, e.g. "Loading models…". */
  empty?: string
  'aria-label': string
  className?: string
}

/**
 * A text field with our own suggestion list (the platform datalist is missing or
 * unreliable on mobile browsers). The full list shows on focus; it narrows once the user
 * types. Any text is allowed, so a model that is not listed can still be entered.
 */
export function Combobox({
  value,
  options,
  onCommit,
  empty = 'No suggestions',
  className = '',
  ...aria
}: ComboboxProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLSpanElement>(null)
  const input = useRef<HTMLInputElement>(null)
  // The part of the text that is only a suggestion, kept selected so typing replaces it.
  const suggested = useRef<[number, number] | null>(null)
  const listId = useId()
  const text = draft ?? value
  const q = draft?.trim().toLowerCase() ?? ''
  const shown =
    draft === null
      ? options
      : [
          ...options.filter((o) => o.toLowerCase().startsWith(q)),
          ...options.filter(
            (o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q),
          ),
        ]

  useLayoutEffect(() => {
    const range = suggested.current
    suggested.current = null
    if (range) input.current?.setSelectionRange(range[0], range[1])
  })

  const finish = (next: string) => {
    setDraft(null)
    setOpen(false)
    setActive(-1)
    if (next.trim() && next !== value) onCommit(next.trim())
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        if (!open) return setOpen(true)
        const step = e.key === 'ArrowDown' ? 1 : -1
        return setActive((a) => Math.min(shown.length - 1, Math.max(0, a + step)))
      }
      case 'Enter':
        e.preventDefault()
        return finish(open && shown[active] ? shown[active] : text)
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation() // closes the list, not the dialog
          setOpen(false)
        }
    }
  }

  return (
    <span
      ref={root}
      className={`relative inline-flex ${className}`}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) finish(text)
      }}
    >
      <Input
        variant="outlined"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={aria['aria-label']}
        value={text}
        className="w-full"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        ref={input}
        onChange={(e) => {
          const typed = e.currentTarget.value
          const adding = typed.length > text.length
          const match =
            adding && typed
              ? options.find((o) => o.toLowerCase().startsWith(typed.toLowerCase()))
              : undefined
          // Typeahead: fill in the rest of the first match and select it.
          if (match && match.length > typed.length) {
            const full = typed + match.slice(typed.length)
            suggested.current = [typed.length, full.length]
            setDraft(full)
          } else setDraft(typed)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <GlassPopover
          id={listId}
          role="listbox"
          className="absolute top-full right-0 z-50 mt-1 max-h-56 min-w-full overflow-y-auto rounded-lg p-1"
        >
          {shown.length === 0 && (
            <div className="px-2 py-1.5 text-xs whitespace-nowrap text-muted">
              {empty}
            </div>
          )}
          {shown.map((o, i) => (
            <div
              key={o}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => finish(o)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs whitespace-nowrap ${
                i === active ? 'bg-line/60' : ''
              }`}
            >
              {o}
              {o === value && <span aria-hidden>✓</span>}
            </div>
          ))}
        </GlassPopover>
      )}
    </span>
  )
}
