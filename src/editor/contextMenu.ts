import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { SymbolAction } from './contextMenuItems'

export interface MenuRequest {
  /** Viewport anchor. */
  x: number
  y: number
}

export interface SymbolTriggerOptions {
  enabled: () => boolean
  onMenu: (at: MenuRequest) => void
  onAction: (action: SymbolAction) => void
}

/** Anchor for a key-opened menu: just under the caret, or the editor's corner. */
function caretAnchor(view: EditorView): MenuRequest {
  const c = view.coordsAtPos(view.state.selection.main.head)
  const r = view.dom.getBoundingClientRect()
  return c ? { x: c.left, y: c.bottom + 2 } : { x: r.left + 16, y: r.top + 16 }
}

/**
 * Right-click or Shift+F10 / the Menu key opens the symbol menu; right-click first puts
 * the caret on the word under the pointer. F12, Shift+F12, Alt+F12 and F2 run the
 * actions directly, ahead of Vim so they always reach us. Ctrl/Cmd+click goes to the
 * definition (path links get the click first).
 */
export function symbolTriggers({
  enabled,
  onMenu,
  onAction,
}: SymbolTriggerOptions): Extension {
  const run = (action: SymbolAction) => (): boolean => {
    if (!enabled()) return false
    onAction(action)
    return true
  }
  return [
    EditorView.domEventHandlers({
      contextmenu(e, view) {
        if (!enabled()) return false
        e.preventDefault()
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        const sel = view.state.selection.main
        // Keep an existing selection when the click lands inside it.
        if (pos !== null && !(sel.from <= pos && pos <= sel.to && !sel.empty)) {
          view.dispatch({ selection: EditorSelection.cursor(pos) })
        }
        onMenu({ x: e.clientX, y: e.clientY })
        return true
      },
      keydown(e, view) {
        const key = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)
        if (!key || !enabled()) return false
        e.preventDefault()
        onMenu(caretAnchor(view))
        return true
      },
      click(e, view) {
        if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || !enabled()) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos === null) return false
        view.dispatch({ selection: EditorSelection.cursor(pos) })
        onAction('definition')
        return true
      },
    }),
    Prec.highest(
      keymap.of([
        { key: 'F12', run: run('definition') },
        { key: 'Shift-F12', run: run('references') },
        { key: 'Alt-F12', run: run('peek') },
        { key: 'F2', run: run('rename') },
      ]),
    ),
  ]
}
