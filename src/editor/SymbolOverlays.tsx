import { useStore } from 'jotai'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { editorHandleAtom } from '../state/editorAtoms'
import { activePathAtom } from '../state/workspaceAtoms'
import { Button, ContextMenu, GlassPopover, type ContextMenuItem } from '../ui'
import { focusEditor, useController } from '../workspace/useWorkspace'
import type { MenuRequest } from './contextMenu'
import { contextMenuItems, type SymbolAction } from './contextMenuItems'
import { searchSymbol, type SymbolHit, type SymbolResult } from './symbolSearch'
import type { SymbolBus } from './symbolBus'
import { isDeclarationAt, symbolAt } from './symbols'

type Ui =
  | { kind: 'menu'; at: MenuRequest; items: ContextMenuItem[] }
  | { kind: 'busy'; text: string }
  | { kind: 'message'; text: string }
  | { kind: 'refs'; name: string; result: SymbolResult; title: string }
  | { kind: 'peek'; name: string; hit: SymbolHit; lines: string[]; top: number }
  | { kind: 'rename'; name: string }
  | { kind: 'renamePreview'; name: string; next: string; result: SymbolResult }

const PEEK_LINES = 12

const where = (h: SymbolHit) => `${h.path}:${h.line}`

export default function SymbolOverlays({ bus }: { bus: SymbolBus }) {
  const controller = useController()
  const store = useStore()
  const [ui, setUi] = useState<Ui | null>(null)
  const cancel = useRef<() => void>(() => {})
  const box = useRef<HTMLDivElement>(null)

  const close = useCallback(
    (restoreFocus = true) => {
      cancel.current()
      setUi(null)
      if (restoreFocus) focusEditor(store)
    },
    [store],
  )

  const view = () => store.get(editorHandleAtom)?.view

  /** Symbol under the caret and whether it sits on its own declaration. */
  const symbolContext = useCallback(() => {
    const v = view()
    if (!v) return null
    const head = v.state.selection.main.head
    const line = v.state.doc.lineAt(head)
    const name = symbolAt(line.text, head - line.from)
    return {
      v,
      name,
      onDeclaration: name !== null && isDeclarationAt(line.text, head - line.from),
      hasSelection: !v.state.selection.main.empty,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const find = useCallback(
    (name: string) => {
      cancel.current()
      const s = searchSymbol(
        (q, b, d) => controller.grepComplete(q, b, d),
        name,
        store.get(activePathAtom),
      )
      cancel.current = s.cancel
      return s.result
    },
    [controller, store],
  )

  const run = useCallback(
    async (action: SymbolAction) => {
      const c = symbolContext()
      if (!c?.name) return
      const name = c.name
      const base = {
        definition: 'Finding definition…',
        references: 'Finding references…',
        peek: 'Finding definition…',
        rename: '',
      }[action]
      if (action === 'rename') return setUi({ kind: 'rename', name })
      setUi({ kind: 'busy', text: base })
      const result = await find(name)
      const defs = result.definitions
      if (action === 'references') {
        return setUi(
          result.refs.length
            ? { kind: 'refs', name, result, title: `References to ${name}` }
            : { kind: 'message', text: `No references to ${name}` },
        )
      }
      if (defs.length === 0)
        return setUi({ kind: 'message', text: `No definition found for ${name}` })
      if (action === 'definition') {
        if (defs.length === 1) {
          close(false)
          return void controller.openFileAt(defs[0]!.path, defs[0]!.line, defs[0]!.col)
        }
        return setUi({
          kind: 'refs',
          name,
          result: { ...result, refs: defs },
          title: `Definitions of ${name}`,
        })
      }
      const hit = defs[0]!
      const text = (await controller.readForPreview(hit.path)) ?? ''
      const lines = text.split('\n').slice(hit.line - 1, hit.line - 1 + PEEK_LINES)
      const head = c.v.state.selection.main.head
      const coords = c.v.coordsAtPos(head)
      const host = box.current?.parentElement?.getBoundingClientRect()
      const top = coords && host ? coords.bottom - host.top + 4 : 40
      setUi({ kind: 'peek', name, hit, lines, top })
    },
    [symbolContext, find, controller, close],
  )

  useEffect(() => {
    const onMenu = (at: MenuRequest) => {
      const c = symbolContext()
      const items = contextMenuItems({
        symbol: c?.name ?? null,
        onDeclaration: c?.onDeclaration ?? false,
        hasSelection: c?.hasSelection ?? false,
        run: (a) => void run(a),
      })
      setUi({ kind: 'menu', at, items })
    }
    bus.attach(onMenu, (a) => void run(a))
    return () => bus.detach()
  }, [bus, run, symbolContext])

  // Focus the card so Esc works without a click.
  useEffect(() => {
    if (ui && ui.kind !== 'menu') box.current?.focus()
  }, [ui?.kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  if (!ui) return null

  if (ui.kind === 'menu') {
    return (
      <ContextMenu
        label="Editor"
        x={ui.at.x}
        y={ui.at.y}
        items={ui.items}
        onDone={(restore) => {
          // Choosing an item may have replaced the menu with another surface.
          setUi((cur) => (cur?.kind === 'menu' ? null : cur))
          if (restore) focusEditor(store)
        }}
      />
    )
  }

  const card =
    'absolute z-30 flex max-h-[60%] flex-col overflow-hidden font-sans text-sm outline-none'

  if (ui.kind === 'busy' || ui.kind === 'message') {
    return (
      <GlassPopover
        ref={box}
        tabIndex={-1}
        role={ui.kind === 'busy' ? 'status' : 'alert'}
        onKeyDown={onKey}
        className={`${card} right-4 top-4 px-4 py-2`}
      >
        {ui.text}
      </GlassPopover>
    )
  }

  if (ui.kind === 'peek') {
    return (
      <GlassPopover
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-label={`Definition of ${ui.name}`}
        onKeyDown={onKey}
        className={`${card} left-4 right-4`}
        style={{ top: ui.top }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1 text-xs text-muted">
          <span className="truncate">{where(ui.hit)}</span>
          <Button size="xs" variant="ghost" onClick={() => close()}>
            Close (Esc)
          </Button>
        </div>
        <pre className="overflow-auto p-3 font-mono text-xs">{ui.lines.join('\n')}</pre>
      </GlassPopover>
    )
  }

  if (ui.kind === 'refs') {
    return (
      <GlassPopover
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-label={ui.title}
        onKeyDown={onKey}
        className={`${card} right-4 top-4 w-[min(36rem,calc(100%-2rem))]`}
      >
        <div className="border-b border-line px-3 py-2 text-xs text-muted">
          {ui.title} · {ui.result.refs.length}
          {ui.result.truncated ? '+' : ''}
        </div>
        <ul className="overflow-auto p-1">
          {ui.result.refs.map((h) => (
            <li key={`${h.path}:${h.line}:${h.col}`}>
              <button
                type="button"
                className="block w-full truncate rounded-md px-2 py-1 text-left hover:bg-accent/10 focus:bg-accent/10 focus:outline-none"
                onClick={() => {
                  close(false)
                  void controller.openFileAt(h.path, h.line, h.col)
                }}
              >
                <span className="text-muted">{where(h)}</span>{' '}
                <span className="font-mono text-xs">{h.text.trim()}</span>
              </button>
            </li>
          ))}
        </ul>
      </GlassPopover>
    )
  }

  if (ui.kind === 'rename') {
    return (
      <RenameCard
        boxRef={box}
        name={ui.name}
        className={`${card} right-4 top-4 w-80 gap-2 p-3`}
        onKey={onKey}
        onCancel={() => close()}
        onSubmit={async (next) => {
          setUi({ kind: 'busy', text: 'Finding occurrences…' })
          const result = await find(ui.name)
          setUi({ kind: 'renamePreview', name: ui.name, next, result })
        }}
      />
    )
  }

  return (
    <RenamePreview
      boxRef={box}
      ui={ui}
      className={`${card} right-4 top-4 w-[min(36rem,calc(100%-2rem))]`}
      onKey={onKey}
      onCancel={() => close()}
      onApply={async (paths) => {
        setUi({ kind: 'busy', text: 'Renaming…' })
        const n = await controller.renameSymbol(paths, ui.name, ui.next)
        setUi({ kind: 'message', text: `Renamed in ${n} file${n === 1 ? '' : 's'}` })
      }}
    />
  )
}

type Box = React.RefObject<HTMLDivElement | null>

function RenameCard({
  boxRef,
  name,
  className,
  onKey,
  onCancel,
  onSubmit,
}: {
  boxRef: Box
  name: string
  className: string
  onKey: (e: KeyboardEvent) => void
  onCancel: () => void
  onSubmit: (next: string) => void
}) {
  const [value, setValue] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.select()
  }, [])
  const valid = /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(value) && value !== name
  return (
    <GlassPopover
      ref={boxRef}
      role="dialog"
      aria-label={`Rename ${name}`}
      onKeyDown={onKey}
      className={className}
    >
      <label className="text-xs text-muted" htmlFor="rename-symbol">
        Rename {name} to
      </label>
      <input
        id="rename-symbol"
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valid) onSubmit(value)
        }}
        className="rounded-md bg-canvas px-2 py-1 font-mono text-sm text-text ring-1 ring-accent/60 focus:outline-none focus:ring-accent"
      />
      {!valid && value !== name && (
        <span className="text-xs text-muted">Not a valid identifier</span>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!valid}
          onClick={() => onSubmit(value)}
        >
          Preview
        </Button>
      </div>
    </GlassPopover>
  )
}

function RenamePreview({
  boxRef,
  ui,
  className,
  onKey,
  onCancel,
  onApply,
}: {
  boxRef: Box
  ui: Extract<Ui, { kind: 'renamePreview' }>
  className: string
  onKey: (e: KeyboardEvent) => void
  onCancel: () => void
  onApply: (paths: string[]) => void
}) {
  const byFile = new Map<string, SymbolHit[]>()
  for (const h of ui.result.refs) byFile.set(h.path, [...(byFile.get(h.path) ?? []), h])
  const files = [...byFile]
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const chosen = files.filter(([p]) => !off.has(p)).map(([p]) => p)
  return (
    <GlassPopover
      ref={boxRef}
      tabIndex={-1}
      role="dialog"
      aria-label={`Rename ${ui.name} to ${ui.next}`}
      onKeyDown={onKey}
      className={className}
    >
      <div className="border-b border-line px-3 py-2 text-xs text-muted">
        Rename {ui.name} → {ui.next}. Text-based: strings and comments are included, so
        review each file.
        {ui.result.truncated && ' Results were truncated; run rename again after.'}
      </div>
      <ul className="overflow-auto p-1">
        {files.map(([path, hits]) => (
          <li key={path}>
            <label className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/10">
              <input
                type="checkbox"
                checked={!off.has(path)}
                onChange={() =>
                  setOff((cur) => {
                    const n = new Set(cur)
                    if (!n.delete(path)) n.add(path)
                    return n
                  })
                }
              />
              <span className="truncate">{path}</span>
              <span className="ml-auto text-xs text-muted">
                {hits.length} line{hits.length === 1 ? '' : 's'}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2 border-t border-line p-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={chosen.length === 0}
          onClick={() => onApply(chosen)}
        >
          Rename in {chosen.length} file{chosen.length === 1 ? '' : 's'}
        </Button>
      </div>
    </GlassPopover>
  )
}
