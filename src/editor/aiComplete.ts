import { closeCompletion, completionStatus } from '@codemirror/autocomplete'
import {
  type Extension,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Transaction,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { isLargeDoc } from './createEditor'

export interface AiCompleteOptions {
  /** Checked on every keystroke, so a setting change applies at once. */
  enabled: () => boolean
  /** Text to insert at the cursor, or null for none. Must honour `signal`. */
  complete: (
    ctx: { prefix: string; suffix: string },
    signal: AbortSignal,
  ) => Promise<string | null>
  /** Called with the reason when a request fails, so the cause can be seen. */
  onError?: (e: unknown) => void
  /** Quiet time after typing before asking, in ms. */
  delay?: number
}

interface Ghost {
  pos: number
  text: string
}

const setGhost = StateEffect.define<Ghost | null>()

class GhostWidget extends WidgetType {
  readonly text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  override eq(other: GhostWidget) {
    return other.text === this.text
  }
  override toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-ai-ghost'
    el.textContent = this.text
    el.setAttribute('aria-hidden', 'true')
    return el
  }
  override ignoreEvent() {
    return true
  }
}

/**
 * Typing the next characters of the suggestion keeps the rest of it, as Copilot does, instead of
 * dropping it. Anything else (another character, a deletion, an edit elsewhere) clears it.
 */
function typedThrough(ghost: Ghost, tr: Transaction): Ghost | null {
  if (!tr.isUserEvent('input.type')) return null
  let typed: string | null = null
  let ok = true
  tr.changes.iterChanges((from, to, _f, _t, inserted) => {
    if (from !== ghost.pos || to !== from || typed !== null) ok = false
    else typed = inserted.toString()
  })
  const t = typed as string | null
  if (!ok || !t || !ghost.text.startsWith(t)) return null
  const rest = ghost.text.slice(t.length)
  return rest ? { pos: ghost.pos + t.length, text: rest } : null
}

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(ghost, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value
    if (!ghost) return null
    if (tr.docChanged) return typedThrough(ghost, tr)
    // A cursor move makes the suggestion stale.
    return tr.selection ? null : ghost
  },
  provide: (f) =>
    EditorView.decorations.from(f, (g): DecorationSet =>
      g
        ? Decoration.set([
            Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos),
          ])
        : Decoration.none,
    ),
})

const ghostTheme = EditorView.baseTheme({
  // Muted and italic: the shape differs from real text, not only the colour.
  '.cm-ai-ghost': {
    color: 'var(--muted)',
    fontStyle: 'italic',
    whiteSpace: 'pre-wrap',
    pointerEvents: 'none',
  },
})

/** Characters that may follow the cursor and still leave room to suggest: closers from auto-pairing. */
const TRAILING_OK = /^[\s)\]}>"'`;,]*$/

/**
 * Where a suggestion is worth asking for: an empty selection with nothing but closing brackets or
 * quotes after it, on a non-blank line or on a fresh line below some code (as after Enter).
 */
function cursorContext(
  state: EditorState,
): { prefix: string; suffix: string; pos: number } | null {
  const sel = state.selection.main
  if (!sel.empty) return null
  const line = state.doc.lineAt(sel.head)
  if (!TRAILING_OK.test(line.text.slice(sel.head - line.from))) return null
  if (line.text.trim() === '') {
    const before = state.doc.sliceString(Math.max(0, line.from - 200), line.from)
    if (before.trim() === '') return null
  }
  return {
    pos: sel.head,
    prefix: state.doc.sliceString(Math.max(0, sel.head - 4000), sel.head),
    suffix: state.doc.sliceString(sel.head, Math.min(state.doc.length, sel.head + 1000)),
  }
}

function accept(view: EditorView): boolean {
  const g = view.state.field(ghostField, false)
  if (!g) return false
  view.dispatch({
    changes: { from: g.pos, insert: g.text },
    selection: { anchor: g.pos + g.text.length },
    userEvent: 'input.complete',
  })
  return true
}

/** Accepts just the next word of the suggestion, and keeps showing the rest. */
function acceptWord(view: EditorView): boolean {
  const g = view.state.field(ghostField, false)
  if (!g) return false
  const word = /^\s*\S+/.exec(g.text)?.[0] ?? g.text
  const rest = g.text.slice(word.length)
  const pos = g.pos + word.length
  view.dispatch({
    changes: { from: g.pos, insert: word },
    selection: { anchor: pos },
    effects: setGhost.of(rest ? { pos, text: rest } : null),
    userEvent: 'input.complete',
  })
  return true
}

function dismiss(view: EditorView): boolean {
  if (!view.state.field(ghostField, false)) return false
  view.dispatch({ effects: setGhost.of(null) })
  return true
}

/**
 * Inline ghost-text suggestions, in the Copilot style. After typing pauses (or after Enter), asks
 * `complete` for text and shows it dimmed after the cursor. Tab accepts all of it, Ctrl or Alt plus
 * Right accepts a word, Escape drops it. Typing the suggestion's own next characters keeps the rest.
 * A failed or empty request shows nothing.
 */
export function aiComplete({
  enabled,
  complete,
  onError,
  delay = 400,
}: AiCompleteOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined
      ctl: AbortController | undefined

      update(u: ViewUpdate) {
        if (!u.docChanged) return
        this.cancel()
        // Typing, Enter, paste and deleting ask; accepting a suggestion or undoing does not.
        const typed = u.transactions.some(
          (t) =>
            (t.isUserEvent('input') && !t.isUserEvent('input.complete')) ||
            t.isUserEvent('delete'),
        )
        if (!typed || !enabled() || isLargeDoc(u.state.doc)) return
        // Typed through a suggestion that is still showing: no new request needed.
        if (u.state.field(ghostField, false)) return
        this.timer = setTimeout(() => this.ask(u.view), delay)
      }

      cancel() {
        clearTimeout(this.timer)
        this.ctl?.abort()
        this.ctl = undefined
      }

      ask(view: EditorView) {
        const ctx = cursorContext(view.state)
        if (!ctx || !enabled()) return
        const doc = view.state.doc
        const ctl = (this.ctl = new AbortController())
        complete({ prefix: ctx.prefix, suffix: ctx.suffix }, ctl.signal).then(
          (text) => {
            // Drop a late answer if the text or cursor moved on.
            if (!text || ctl.signal.aborted) return
            if (view.state.doc !== doc || view.state.selection.main.head !== ctx.pos)
              return
            // The word popup would sit over the suggestion and take Enter, so the suggestion wins.
            if (completionStatus(view.state) !== null) closeCompletion(view)
            view.dispatch({ effects: setGhost.of({ pos: ctx.pos, text }) })
          },
          (e) => {
            // Locked vault, no key, offline: no suggestion, and no error in the editor.
            if (!ctl.signal.aborted) onError?.(e)
          },
        )
      }

      destroy() {
        this.cancel()
      }
    },
  )

  return [
    ghostField,
    ghostTheme,
    plugin,
    // Above indentWithTab and the completion keymap; false when no suggestion shows.
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: accept },
        { key: 'Ctrl-ArrowRight', run: acceptWord },
        { key: 'Alt-ArrowRight', run: acceptWord },
        { key: 'Escape', run: dismiss },
      ]),
    ),
  ]
}
