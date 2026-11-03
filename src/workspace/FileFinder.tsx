import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { matchFiles } from '../editor/paletteSearch'
import { Icon } from '../ui'
import { dirname } from './path'
import type { Entry } from './types'

interface FileFinderProps {
  /** The workspace tree. Only its files are searched. */
  tree: Entry[]
  /** The typed query. Empty means no results are shown. */
  value: string
  onChange: (value: string) => void
  onOpen: (path: string) => void
  /** Accessible name of the search box. Use a different one where two finders can show at once. */
  label: string
  /** Disable searching and opening while a tree mutation is in progress. */
  disabled?: boolean
  /** Classes for the outer wrapper. */
  className?: string
  /** Classes for the results list. */
  listClassName?: string
}

/**
 * Quick file finder: a search box and the files whose path has every typed word. Arrow
 * keys move through the results, Enter opens one, and Escape clears the query. The
 * sidebar and the blank page both use it.
 */
export default function FileFinder({
  tree,
  value,
  onChange,
  onOpen,
  label,
  disabled = false,
  className = '',
  listClassName = 'min-h-0 flex-1 overflow-auto px-2 pb-2',
}: FileFinderProps) {
  const [highlight, setHighlight] = useState(0)
  const listId = useId()
  const files = useMemo(() => tree.filter((e) => e.kind === 'file'), [tree])
  const matches = useMemo(
    () => (value.trim() ? matchFiles(files, value) : null),
    [files, value],
  )
  const active = matches ? Math.min(highlight, Math.max(matches.length - 1, 0)) : 0

  // Keep the highlighted result in view as the arrow keys move through the list.
  useEffect(() => {
    if (matches)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (e.key === 'Escape') {
      // First Escape clears the search; a second one is left to the surrounding page.
      if (value === '') return
      e.preventDefault()
      e.stopPropagation()
      onChange('')
      return
    }
    if (!matches || matches.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((active + step + matches.length) % matches.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onOpen(matches[active]!.path)
    }
  }

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="shrink-0 px-2 pb-2">
        <label className="flex h-7 items-center gap-2 rounded-md bg-surface px-2 text-muted focus-within:text-text focus-within:ring-1 focus-within:ring-accent/50">
          <Icon name="search" className="size-3.5 shrink-0" />
          <input
            type="text"
            aria-label={label}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={matches?.length ? `${listId}-${active}` : undefined}
            placeholder="Find a file"
            value={value}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              onChange(e.target.value)
              setHighlight(0)
            }}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
      </div>

      {matches ? (
        <ul id={listId} role="listbox" aria-label="Matching files" className={listClassName}>
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted">No matching files</li>
          )}
          {matches.map((entry, i) => (
            <li
              key={entry.path}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={disabled || undefined}
              onMouseEnter={() => {
                if (!disabled) setHighlight(i)
              }}
              onClick={() => {
                if (!disabled) onOpen(entry.path)
              }}
              className={`flex flex-col rounded-md px-2 py-1.5 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${i === active ? 'bg-surface' : ''}`}
            >
              <span className="truncate text-sm text-text">{entry.name}</span>
              <span className="truncate text-xs text-muted">
                {dirname(entry.path) || '/'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
