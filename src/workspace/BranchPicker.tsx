import { useAtomValue } from 'jotai'
import { useEffect, useId, useRef, useState } from 'react'
import { branchSwitchAtom } from '../state/gitAtoms'
import { GlassPopover } from '../ui/GlassPopover'
import { Icon } from '../ui/Icon'
import { useController } from './useWorkspace'

/**
 * The branch name as a button: it opens the list of local branches at once (the list
 * itself loads after) and picking one checks it out. While a switch runs the button says
 * so and cannot be pressed again.
 */
export default function BranchPicker({ branch }: { branch: string }) {
  const controller = useController()
  const switching = useAtomValue(branchSwitchAtom)
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<string[] | null>(null)
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    let live = true
    void controller.listBranches().then((r) => live && setBranches(r?.branches ?? []))
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      live = false
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, controller])

  const shown = (branches ?? []).filter((b) =>
    b.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  const close = () => {
    setOpen(false)
    setFilter('')
    button.current?.focus()
  }
  const pick = (name: string | undefined) => {
    if (!name) return
    close()
    if (name !== branch) void controller.switchBranch(name)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        return setActive((i) => Math.min(shown.length - 1, i + 1))
      case 'ArrowUp':
        e.preventDefault()
        return setActive((i) => Math.max(0, i - 1))
      case 'Enter':
        e.preventDefault()
        return pick(shown[active])
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        return close()
    }
  }

  if (switching !== null) {
    return (
      <span className="text-text motion-safe:animate-pulse" role="status">
        Switching to {switching}…
      </span>
    )
  }

  return (
    <span ref={root} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Switch branch. Current branch ${branch}`}
        onClick={() => {
          setActive(0)
          setOpen((o) => !o)
        }}
        className="inline-flex items-center gap-0.5 rounded-sm text-text underline decoration-muted/60 underline-offset-4 transition-colors hover:decoration-text active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {branch}
        <Icon name="chevron-down" className="size-3 text-muted" />
      </button>
      {open && (
        <GlassPopover className="absolute top-full left-1/2 z-50 mt-1 w-56 -translate-x-1/2 rounded-lg p-1 text-left">
          <input
            autoFocus
            aria-label="Filter branches"
            aria-controls={listId}
            placeholder="Filter branches"
            value={filter}
            onChange={(e) => {
              setFilter(e.currentTarget.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="mb-1 w-full rounded-md border border-muted bg-canvas px-2 py-1 text-xs text-text focus-visible:outline-2 focus-visible:outline-accent"
          />
          {branches === null ? (
            <p className="px-2 py-1.5 text-xs text-muted">Loading branches…</p>
          ) : shown.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted">No matching branches</p>
          ) : (
            <div
              id={listId}
              role="listbox"
              aria-label="Branches"
              className="max-h-60 overflow-y-auto"
            >
              {shown.map((b, i) => (
                <div
                  key={b}
                  role="option"
                  aria-selected={b === branch}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(b)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs ${
                    i === active ? 'bg-line/60' : ''
                  }`}
                >
                  <span className="truncate">{b}</span>
                  {b === branch && (
                    <span className="flex items-center gap-1 text-muted">
                      current
                      <Icon name="check" className="size-3.5" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassPopover>
      )}
    </span>
  )
}
