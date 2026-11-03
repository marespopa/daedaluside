import { atom } from 'jotai'
import type { EditorHandle } from '../editor/createEditor'

/** Metadata only. CodeMirror owns the document text. */
export interface BufferMeta {
  id: string
  name: string
  language: string | null
  dirty: boolean
  line: number
  column: number
  length: number
}

export const initialBuffer: BufferMeta = {
  id: '',
  name: '',
  language: null,
  dirty: false,
  line: 1,
  column: 1,
  length: 0,
}

/**
 * `measured` keeps the reading column (see the breakpoints in index.css); `full`
 * lets the text use the whole pane. Saved so a reload keeps the choice.
 */
export type EditorWidth = 'measured' | 'full'

export const EDITOR_WIDTH_KEY = 'daedalus.editorWidth'

export function loadEditorWidth(): EditorWidth {
  try {
    return globalThis.localStorage?.getItem(EDITOR_WIDTH_KEY) === 'full'
      ? 'full'
      : 'measured'
  } catch {
    return 'measured'
  }
}

const widthBase = atom<EditorWidth>(loadEditorWidth())
export const editorWidthAtom = atom(
  (get) => get(widthBase),
  (_get, set, next: EditorWidth) => {
    set(widthBase, next)
    try {
      globalThis.localStorage?.setItem(EDITOR_WIDTH_KEY, next)
    } catch {
      /* storage unavailable: the choice still applies for this session */
    }
  },
)

export const VIM_MODE_KEY = 'daedalus.vimMode'

/** On unless the user has turned it off. */
export function loadVimEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(VIM_MODE_KEY) !== 'off'
  } catch {
    return true
  }
}

const vimBase = atom<boolean>(loadVimEnabled())
/** On by default. Saved so a reload keeps the choice. */
export const vimEnabledAtom = atom(
  (get) => get(vimBase),
  (_get, set, next: boolean) => {
    set(vimBase, next)
    try {
      globalThis.localStorage?.setItem(VIM_MODE_KEY, next ? 'on' : 'off')
    } catch {
      /* storage unavailable: the choice still applies for this session */
    }
  },
)

export type VimModeLabel =
  'NORMAL' | 'INSERT' | 'REPLACE' | 'VISUAL' | 'V-LINE' | 'V-BLOCK'

/** The footnote under the editor. `prompt` is true while the `:` or `/` line is open. */
export interface VimStatus {
  label: VimModeLabel
  prompt: boolean
}

export const vimStatusAtom = atom<VimStatus | null>(null)

export const activeBufferAtom = atom<BufferMeta>(initialBuffer)
export const editorHandleAtom = atom<EditorHandle | null>(null)
export const paletteOpenAtom = atom(false)
/** Palette input text. A leading `>` means commands; anything else searches files. */
export const paletteQueryAtom = atom('')
