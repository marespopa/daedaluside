import { closeCompletion, completionStatus } from '@codemirror/autocomplete'
import {
  type Extension,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
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

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(ghost, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value
    // Any edit or cursor move makes the suggestion stale.
    return tr.docChanged || tr.selection ? null : ghost
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

/** Where a suggestion is worth asking for: an empty selection at the end of a non-blank line. */
function cursorContext(
  state: EditorState,
): { prefix: string; suffix: string; pos: number } | null {
  const sel = state.selection.main
  if (!sel.empty) return null
  const line = state.doc.lineAt(sel.head)
  if (line.text.slice(sel.head - line.from).trim() !== '') return null
  if (line.text.trim() === '') return null
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

function dismiss(view: EditorView): boolean {
  if (!view.state.field(ghostField, false)) return false
  view.dispatch({ effects: setGhost.of(null) })
  return true
}

/**
 * Inline ghost-text suggestions. After typing pauses at the end of a line, asks `complete` for text
 * and shows it dimmed after the cursor. Tab accepts it, Escape or any other edit drops it. A failed
 * or empty request shows nothing.
 */
export function aiComplete({
  enabled,
  complete,
  delay = 700,
}: AiCompleteOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined
      ctl: AbortController | undefined

      update(u: ViewUpdate) {
        if (!u.docChanged) return
        this.cancel()
        // Only typing and deleting ask; accepting a suggestion or undoing does not.
        const typed = u.transactions.some(
          (t) => t.isUserEvent('input.type') || t.isUserEvent('delete'),
        )
        if (!typed || !enabled() || isLargeDoc(u.state.doc)) return
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
          () => {
            /* locked vault, no key, offline: stay quiet */
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
        { key: 'Escape', run: dismiss },
      ]),
    ),
  ]
}
