import type { EditorView } from '@codemirror/view'
import { getCM, Vim } from '@replit/codemirror-vim'

/** Runs an Ex line, as typing `:line` and Enter would. Vim mode must be on. */
export function runEx(view: EditorView, line: string) {
  Vim.handleEx(getCM(view)! as unknown as Parameters<typeof Vim.handleEx>[0], line)
}
