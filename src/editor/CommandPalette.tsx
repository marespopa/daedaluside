import { openSearchPanel } from '@codemirror/search'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { themeAtom } from '../lib/theme'
import { activeBufferAtom, editorHandleAtom, paletteOpenAtom } from '../state/editorAtoms'
import { languageList } from './languages'

interface Command {
  id: string
  label: string
  run: () => void
}

export default function CommandPalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom)
  const handle = useAtomValue(editorHandleAtom)
  const setTheme = useSetAtom(themeAtom)
  const setBuffer = useSetAtom(activeBufferAtom)

  // Mod-K toggles the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const commands = useMemo<Command[]>(() => {
    const theme = (id: 'system' | 'light' | 'dark', label: string): Command => ({
      id: `theme-${id}`,
      label: `Theme: ${label}`,
      run: () => setTheme(id),
    })
    const langs: Command[] = languageList.map((l) => ({
      id: `lang-${l.name}`,
      label: `Language: ${l.name}`,
      run: () =>
        void handle
          ?.setLanguage(l.name)
          .then((language) => setBuffer((b) => ({ ...b, language }))),
    }))
    return [
      theme('light', 'Light'),
      theme('dark', 'Dark'),
      theme('system', 'System'),
      {
        id: 'find',
        label: 'Find and Replace',
        run: () => handle && openSearchPanel(handle.view),
      },
      {
        id: 'lang-none',
        label: 'Language: Plain Text',
        run: () =>
          void handle
            ?.setLanguage(null)
            .then(() => setBuffer((b) => ({ ...b, language: null }))),
      },
      ...langs,
    ]
  }, [handle, setTheme, setBuffer])

  if (!open) return null
  return (
    <PaletteDialog
      commands={commands}
      onClose={() => setOpen(false)}
      onRestoreFocus={() => handle?.view.focus()}
    />
  )
}

function PaletteDialog({
  commands,
  onClose,
  onRestoreFocus,
}: {
  commands: Command[]
  onClose: () => void
  onRestoreFocus: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 50)
    const words = q.split(/\s+/)
    return commands
      .filter((c) => words.every((w) => c.label.toLowerCase().includes(w)))
      .slice(0, 50)
  }, [commands, query])

  useEffect(() => {
    input.current?.focus()
    return onRestoreFocus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = (c: Command | undefined) => {
    if (!c) return
    onClose()
    c.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[index])
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/60 px-4 pt-[15vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="glass w-full max-w-lg rounded-xl border border-line shadow-lg"
        onKeyDown={onKeyDown}
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          placeholder="Type a command"
          className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
        />
        <ul
          id="palette-list"
          role="listbox"
          className="max-h-72 overflow-auto border-t border-line"
        >
          {results.length === 0 && (
            <li className="px-4 py-2 text-sm text-muted">No matches</li>
          )}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === index}
              className={`cursor-pointer px-4 py-1.5 text-sm ${i === index ? 'bg-accent text-canvas' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              {c.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
