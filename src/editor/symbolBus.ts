import type { MenuRequest } from './contextMenu'
import type { SymbolAction } from './contextMenuItems'

/** Lets the CodeMirror extension (created once) reach the React overlays. */
export class SymbolBus {
  private onMenu: ((at: MenuRequest) => void) | null = null
  private onAction: ((a: SymbolAction) => void) | null = null

  attach(menu: (at: MenuRequest) => void, action: (a: SymbolAction) => void) {
    this.onMenu = menu
    this.onAction = action
  }
  detach() {
    this.onMenu = null
    this.onAction = null
  }
  menu(at: MenuRequest) {
    this.onMenu?.(at)
  }
  action(a: SymbolAction) {
    this.onAction?.(a)
  }
}
