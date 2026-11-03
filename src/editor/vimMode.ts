import { Compartment, Prec, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type PluginValue } from '@codemirror/view'
import { getCM, Vim, vim, type CodeMirror, type ExParams } from '@replit/codemirror-vim'
import type { VimModeLabel, VimStatus } from '../state/editorAtoms'

/**
 * What Vim commands do to the workspace. The app binds it once (useWorkspaceLifecycle);
 * the Ex commands below call whatever is bound.
 */
export interface VimHost {
  save(): void
  close(): void
  discard(): void
  open(name: string): void
  cycle(delta: 1 | -1): void
  explore(): void
  notify(text: string): void
  status(next: VimStatus): void
}

let host: VimHost | null = null

export function bindVimHost(next: VimHost | null) {
  host = next
}

/** Holds the Vim extension. Each state records whether it is on, so stashed buffers keep it. */
export const vimCompartment = new Compartment()

/** Opens Vim's `:` line on an existing view, including the read-only blank-page view. */
export function openExPrompt(view: EditorView): boolean {
  const cm = getCM(view)
  if (!cm) return false
  view.focus()
  Vim.handleKey(cm, ':', 'user')
  return true
}

export function vimModeLabel(e: { mode: string; subMode?: string }): VimModeLabel {
  switch (e.mode) {
    case 'insert':
      return 'INSERT'
    case 'replace':
      return 'REPLACE'
    case 'visual':
      if (e.subMode === 'linewise') return 'V-LINE'
      if (e.subMode === 'blockwise') return 'V-BLOCK'
      return 'VISUAL'
    default:
      return 'NORMAL'
  }
}

function registerVimCommands() {
  // Vim passes the text after a command as argString. A lone `!` is the bang of `:q!`.
  const argOf = (p: ExParams) => p.argString?.trim() ?? ''
  Vim.defineEx('write', 'w', (_cm, p) => {
    const arg = argOf(p)
    if (arg !== '' && arg !== '!')
      return host?.notify('Writing to another file is not supported')
    host?.save()
  })
  Vim.defineEx('quit', 'q', (_cm, p) =>
    argOf(p) === '!' ? host?.discard() : host?.close(),
  )
  Vim.defineEx('wq', 'wq', () => host?.close())
  Vim.defineEx('bdelete', 'bd', (_cm, p) =>
    argOf(p) === '!' ? host?.discard() : host?.close(),
  )
  Vim.defineEx('edit', 'e', (_cm, p) => {
    const arg = argOf(p)
    if (arg === '!') return host?.notify('Reverting to the saved file is not supported')
    host?.open(arg)
  })
  Vim.defineEx('bnext', 'bn', () => host?.cycle(1))
  Vim.defineEx('bprev', 'bp', () => host?.cycle(-1))
  // netrw's drawer commands all open the same left-hand tree and focus it.
  Vim.defineEx('Explore', 'Ex', () => host?.explore())
  Vim.defineEx('Explore', 'E', () => host?.explore())
  Vim.defineEx('explore', 'explore', () => host?.explore())
  Vim.defineEx('Sexplore', 'Sex', () => host?.explore())
  Vim.defineEx('Vexplore', 'Vex', () => host?.explore())
  // Escape from insert mode without reaching for the Esc key.
  Vim.map('jk', '<Esc>', 'insert')
  Vim.map('jj', '<Esc>', 'insert')
}

registerVimCommands()

/** Feeds the footnote: the current mode, and whether the `:` or `/` line is open. */
class VimStatusPlugin implements PluginValue {
  private cm: CodeMirror | null
  private label: VimModeLabel = 'NORMAL'

  constructor(view: EditorView) {
    this.cm = getCM(view)
    this.cm?.on('vim-mode-change', this.onMode)
    this.cm?.on('dialog', this.publish)
    this.publish()
  }

  destroy() {
    this.cm?.off('vim-mode-change', this.onMode)
    this.cm?.off('dialog', this.publish)
  }

  private onMode = (e: { mode: string; subMode?: string }) => {
    this.label = vimModeLabel(e)
    this.publish()
  }

  private publish = () => {
    host?.status({ label: this.label, prompt: !!this.cm?.state.dialog })
  }
}

/**
 * Ctrl and Cmd chords the app owns (file tree, palette, save, new file, open file,
 * tab close). Vim would otherwise take Ctrl-B, Ctrl-N, Ctrl-O and Ctrl-P, so these pass
 * through to the window handlers, as they do with Vim mode off.
 */
const APP_SHORTCUT_LETTERS = new Set(['b', 'k', 'n', 'o', 'p', 's', 'w'])
const appShortcuts = Prec.highest(
  EditorView.domEventHandlers({
    keydown(e) {
      if (!(e.metaKey || e.ctrlKey)) return false
      const letter = /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase()
      return (letter !== undefined && APP_SHORTCUT_LETTERS.has(letter)) || e.key === ','
    },
  }),
)

const vimLook = Prec.highest(
  EditorView.theme({
    // Normal and visual mode: a full-block accent cursor, the glyph under it in the canvas colour.
    '&.cm-focused .cm-vimCursorLayer .cm-fat-cursor': {
      background: 'var(--accent)',
      color: 'var(--canvas) !important',
    },
    '&:not(.cm-focused) .cm-vimCursorLayer .cm-fat-cursor': {
      background: 'none',
      outline: '1px solid var(--accent)',
    },
    // The `:` and `/` line: one mono row at the bottom, no inner chrome.
    '.cm-vim-panel': {
      padding: '0.5rem var(--editor-gutter)',
      minHeight: 'auto',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
    },
    '.cm-vim-panel input': {
      flex: '1',
      minWidth: '0',
      color: 'var(--text)',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      font: 'inherit',
    },
  }),
)

/** Install with `vimCompartment.of(vimExtension)`. Must come before the other keymaps. */
export const vimExtension: Extension = [
  vim(),
  appShortcuts,
  vimLook,
  ViewPlugin.fromClass(VimStatusPlugin),
]
