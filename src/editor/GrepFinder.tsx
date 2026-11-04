import { useAtom, useAtomValue, useStore } from 'jotai'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  editorHandleAtom,
  grepOpenAtom,
  grepQueryAtom,
  grepStatusAtom,
  paletteOpenAtom,
} from '../state/editorAtoms'
import { currentWorkspaceIdAtom } from '../state/workspaceAtoms'
import { GlassPopover, Input } from '../ui'
import type { GrepHit } from '../workspace/grep'
import { useController } from '../workspace/useWorkspace'

const ROW_HEIGHT = 28
const VIEW_ROWS = 12
const OVERSCAN = 4
const CONTEXT = 4

/**
 * Telescope-style live grep: type to search file contents across the workspace. The
 * results stream in from the text index (see grep.ts) as you type; Enter jumps to the
 * line. Mod-Shift-F opens it.
 */
export default function GrepFinder() {
  const store = useStore()
  const [open, setOpen] = useAtom(grepOpenAtom)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || !e.shiftKey) return
      if (e.key.toLowerCase() !== 'f') return
      e.preventDefault()
      const next = !store.get(grepOpenAtom)
      if (next) store.set(paletteOpenAtom, false)
      store.set(grepOpenAtom, next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  if (!open) return null
  return <GrepDialog onClose={() => setOpen(false)} />
}

function GrepDialog({ onClose }: { onClose: () => void }) {
  const controller = useController()
  const handle = useAtomValue(editorHandleAtom)
  const hasWorkspace = useAtomValue(currentWorkspaceIdAtom) != null
  const status = useAtomValue(grepStatusAtom)
  const [query, setQuery] = useAtom(grepQueryAtom)
  const [rawHits, setHits] = useState<GrepHit[]>([])
  const [searching, setSearching] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [index, setIndex] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Re-run once indexing finishes, so a query typed early picks up files indexed later.
  const indexed = status ? status.indexed >= status.total : true
  const hits = useMemo(() => (query === '' ? [] : rawHits), [query, rawHits])
  const sel = hits.length === 0 ? -1 : Math.min(index, hits.length - 1)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    return () => handle?.view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Search on every keystroke. Old results stay up until the first new batch lands, so
  // the list does not flash empty between keystrokes.
  useEffect(() => {
    if (query === '') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new search starts here
    setSearching(true)
    let fresh = true
    let pending: GrepHit[] = []
    let frame = 0
    const flush = () => {
      frame = 0
      const batch = pending
      pending = []
      if (batch.length === 0) return
      // Capture now: React runs the updater later, after `fresh` has been cleared.
      const replace = fresh
      setHits((prev) => (replace ? batch : [...prev, ...batch]))
      if (fresh) {
        fresh = false
        setIndex(0)
        if (list.current) list.current.scrollTop = 0
      }
    }
    const cancel = controller.grep(
      query,
      (batch) => {
        pending.push(...batch)
        // Coalesce bursts into one render per frame.
        if (!frame) frame = requestAnimationFrame(flush)
      },
      (more) => {
        if (frame) cancelAnimationFrame(frame)
        flush()
        if (fresh) setHits([]) // finished without a single hit
        setTruncated(more)
        setSearching(false)
      },
    )
    return () => {
      cancel()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [query, controller, indexed])

  const selected = sel >= 0 ? hits[sel] : undefined
  const preview = usePreview(selected)

  // Keep the selected row in view.
  useEffect(() => {
    const el = list.current
    if (!el || sel < 0) return
    const top = sel * ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight
  }, [sel])

  const choose = (hit: GrepHit | undefined) => {
    if (!hit) return
    onClose()
    void controller.openFileAt(hit.path, hit.line, hit.col)
  }

  const move = (delta: number) => {
    if (hits.length > 0) setIndex(Math.min(Math.max(sel + delta, 0), hits.length - 1))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' || (ctrl && (e.key === 'n' || e.key === 'j'))) {
      // Telescope-style Ctrl-N/P/J/K; stop them reaching the global palette shortcuts.
      e.preventDefault()
      e.stopPropagation()
      move(1)
    } else if (e.key === 'ArrowUp' || (ctrl && (e.key === 'p' || e.key === 'k'))) {
      e.preventDefault()
      e.stopPropagation()
      move(-1)
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      move(VIEW_ROWS)
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      move(-VIEW_ROWS)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(selected)
    }
  }

  // Virtualize: only the rows in (and just around) the viewport exist in the DOM.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(hits.length, first + VIEW_ROWS + OVERSCAN * 2 + 1)
  const rows = useMemo(() => hits.slice(first, last), [hits, first, last])

  const message = !hasWorkspace
    ? 'Open a folder to search its files.'
    : query === ''
      ? 'Type to search file contents'
      : hits.length === 0 && !searching
        ? 'No matches'
        : null

  const indexing =
    status && status.indexed < status.total
      ? `Indexing ${status.indexed.toLocaleString()} / ${status.total.toLocaleString()} files`
      : null

  const summary = [
    hits.length > 0 &&
      `${hits.length.toLocaleString()}${truncated ? '+' : ''} match${hits.length === 1 ? '' : 'es'}`,
    indexing,
    status?.partial && 'Partial index (workspace is very large)',
  ].filter(Boolean)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/60 px-4 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <GlassPopover
        role="dialog"
        aria-modal="true"
        aria-label="Live grep"
        className="w-full max-w-5xl overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <Input
          ref={input}
          variant="bare"
          size="lg"
          className="w-full"
          role="combobox"
          aria-label="Live grep search"
          aria-expanded="true"
          aria-controls="grep-list"
          aria-activedescendant={sel >= 0 ? `grep-option-${sel}` : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search text in all files"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="flex border-t border-line">
          <div
            ref={list}
            id="grep-list"
            role="listbox"
            aria-label="Matches"
            // Clicking an option keeps focus in the input, so typing and Escape still work.
            onMouseDown={(e) => e.preventDefault()}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="min-w-0 flex-1 overflow-auto"
            style={{ height: ROW_HEIGHT * VIEW_ROWS }}
          >
            {message ? (
              <p className="px-4 py-2 text-sm text-muted">{message}</p>
            ) : (
              <div style={{ height: hits.length * ROW_HEIGHT, position: 'relative' }}>
                {rows.map((h, i) => {
                  const n = first + i
                  return (
                    <HitRow
                      key={`${h.path}:${h.line}:${h.col}`}
                      hit={h}
                      id={`grep-option-${n}`}
                      top={n * ROW_HEIGHT}
                      selected={n === sel}
                      queryLength={query.length}
                      onHover={() => setIndex(n)}
                      onChoose={() => choose(h)}
                    />
                  )
                })}
              </div>
            )}
          </div>
          <Preview
            hit={selected}
            lines={preview}
            queryLength={query.length}
            className="hidden w-[45%] shrink-0 border-l border-line md:block"
            height={ROW_HEIGHT * VIEW_ROWS}
          />
        </div>
        {summary.length > 0 && (
          <p
            className="border-t border-line px-4 py-1 text-xs text-muted"
            aria-live="polite"
          >
            {summary.join(' · ')}
          </p>
        )}
      </GlassPopover>
    </div>
  )
}

function HitRow({
  hit,
  id,
  top,
  selected,
  queryLength,
  onHover,
  onChoose,
}: {
  hit: GrepHit
  id: string
  top: number
  selected: boolean
  queryLength: number
  onHover: () => void
  onChoose: () => void
}) {
  const at = hit.col - hit.start
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-label={`${hit.path}:${hit.line} ${hit.text.trim()}`}
      onMouseEnter={onHover}
      onClick={onChoose}
      className={`absolute inset-x-0 flex cursor-pointer items-center gap-3 px-4 text-sm ${selected ? 'bg-accent text-canvas' : ''}`}
      style={{ top, height: ROW_HEIGHT }}
    >
      <span
        className={`max-w-[45%] shrink-0 truncate text-xs ${selected ? '' : 'text-muted'}`}
      >
        {hit.path}:{hit.line}
      </span>
      <span className="min-w-0 truncate whitespace-pre font-mono text-xs">
        {hit.start > 0 && '…'}
        {hit.text.slice(0, at).trimStart()}
        <mark
          className={`rounded-sm bg-transparent font-semibold ${selected ? 'text-canvas underline' : 'text-accent'}`}
        >
          {hit.text.slice(at, at + queryLength)}
        </mark>
        {hit.text.slice(at + queryLength)}
      </span>
    </div>
  )
}

interface PreviewLines {
  first: number
  lines: string[]
}

/** Loads the selected file and slices out the lines around the hit. Debounced so holding an arrow key stays smooth. */
function usePreview(hit: GrepHit | undefined): PreviewLines | null {
  const controller = useController()
  const [state, setState] = useState<{ key: string; value: PreviewLines | null } | null>(
    null,
  )
  const cache = useRef<{ path: string; lines: string[] } | null>(null)
  const path = hit?.path
  const line = hit?.line
  const key = path === undefined ? '' : `${path}:${line}`

  useEffect(() => {
    if (path === undefined || line === undefined) return
    let live = true
    const slice = (all: string[]): PreviewLines => {
      const from = Math.max(0, line - 1 - CONTEXT)
      return { first: from + 1, lines: all.slice(from, line + CONTEXT) }
    }
    if (cache.current?.path === path) {
      setState({ key, value: slice(cache.current.lines) })
      return
    }
    const timer = setTimeout(() => {
      void controller.readForPreview(path).then((text) => {
        if (!live) return
        if (text === null) return setState({ key, value: null })
        const all = text.split('\n')
        cache.current = { path, lines: all }
        setState({ key, value: slice(all) })
      })
    }, 60)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [controller, path, line, key])

  return state?.key === key ? state.value : null
}

function Preview({
  hit,
  lines,
  queryLength,
  className,
  height,
}: {
  hit: GrepHit | undefined
  lines: PreviewLines | null
  queryLength: number
  className: string
  height: number
}) {
  return (
    <div className={`overflow-hidden ${className}`} style={{ height }} aria-hidden="true">
      {hit && lines && (
        <pre className="m-0 px-3 py-2 font-mono text-xs leading-5">
          {lines.lines.map((text, i) => {
            const n = lines.first + i
            const current = n === hit.line
            const at = hit.col
            return (
              <div
                key={n}
                className={`flex gap-3 whitespace-pre ${current ? 'bg-surface' : ''}`}
              >
                <span className="w-8 shrink-0 select-none text-right text-muted">{n}</span>
                <span className="min-w-0 overflow-hidden">
                  {current ? (
                    <>
                      {text.slice(0, at)}
                      <mark className="rounded-sm bg-transparent font-semibold text-accent underline">
                        {text.slice(at, at + queryLength)}
                      </mark>
                      {text.slice(at + queryLength)}
                    </>
                  ) : (
                    text
                  )}
                </span>
              </div>
            )
          })}
        </pre>
      )}
    </div>
  )
}
