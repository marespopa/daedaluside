import type { ContextMenuItem } from '../ui'
import { ALT_KEY_LABEL, MOD_KEY_LABEL } from '../lib/platform'

export type SymbolAction = 'definition' | 'references' | 'peek' | 'rename'

export interface MenuContext {
  /** Identifier under the caret, if any. */
  symbol: string | null
  /** The symbol sits on its own declaration line. */
  onDeclaration: boolean
  hasSelection: boolean
  run: (action: SymbolAction) => void
}

const SOON = 'Needs language server'

/**
 * Builds the menu: three groups, 5-7 items. Which items lead depends on the caret:
 * declaration -> references/rename first; call site -> definition/peek first.
 */
export function contextMenuItems(c: MenuContext): ContextMenuItem[] {
  const has = c.symbol !== null
  const act = (a: SymbolAction) => () => c.run(a)
  const live = (id: SymbolAction, label: string, shortcut: string): ContextMenuItem => ({
    id,
    label,
    shortcut,
    disabled: !has,
    run: act(id),
  })
  const soon = (id: string, label: string, shortcut?: string): ContextMenuItem => ({
    id,
    label,
    ...(shortcut ? { shortcut } : {}),
    note: SOON,
    disabled: true,
    run: () => undefined,
  })

  const definition = live('definition', 'Go to Definition', 'F12')
  const references = live('references', 'Find All References', 'Shift+F12')
  const peek = live('peek', 'Peek Definition', `${ALT_KEY_LABEL}+F12`)
  const rename = live('rename', 'Rename Symbol', 'F2')
  const hover = soon('hover', 'Show Hover', `${MOD_KEY_LABEL}+K ${MOD_KEY_LABEL}+I`)
  const hierarchy = soon('hierarchy', 'Call Hierarchy')
  const typeDef = soon('type', 'Go to Type Definition')
  const extract = soon('extract', 'Extract to Function')

  const nav = c.onDeclaration
    ? [references, definition, peek]
    : [definition, peek, references]
  const info = c.onDeclaration ? [hierarchy, hover] : [hover, hierarchy]
  const refactor = [rename, ...(c.hasSelection ? [extract] : [])]
  // Type Definition only earns a slot at a call site, keeping the menu at 7 or fewer.
  const first = c.onDeclaration ? nav : [...nav.slice(0, 2), typeDef, nav[2]!]

  const groups = [first, info, refactor]
  return groups.flatMap((g, gi) =>
    g.map((item, i) => (gi > 0 && i === 0 ? { ...item, separator: true } : item)),
  )
}
