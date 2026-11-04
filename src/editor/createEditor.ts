import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { bracketMatching, foldKeymap, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view'
import { diffGutter } from './diffGutter'
import { loadLanguage } from './languages'
import { editorTheme } from './theme'
import { vimCompartment, vimExtension } from './vimMode'

export interface EditorOptions {
  parent: HTMLElement
  doc?: string
  /** File name or language name used to pick a language (e.g. `main.ts`). */
  filename?: string
  onUpdate?: (update: ViewUpdate) => void
  extensions?: Extension[]
}

export interface EditorHandle {
  view: EditorView
  /** Lazily loads and applies a language. Resolves to its name, or null if unknown. */
  setLanguage(nameOrFile: string | null): Promise<string | null>
  /** Builds a fresh state with the standard extensions, for multi-buffer use. */
  createState(doc: string): EditorState
  /** Swaps the whole state (document, history, selection). Language is not carried over. */
  setState(state: EditorState): void
  /** Turns Vim keybindings on or off. The document, selection and undo history are kept. */
  setVim(on: boolean): void
  destroy(): void
}

export function createEditor({
  parent,
  doc = '',
  filename,
  onUpdate,
  extensions = [],
}: EditorOptions): EditorHandle {
  const language = new Compartment()
  let langRequest = 0
  let vimOn = false

  const vimFor = (on: boolean): Extension => (on ? vimExtension : [])
  const isVimOn = (state: EditorState) => vimCompartment.get(state) === vimExtension
  // Stashed buffers keep the Vim setting they were saved with. Bring them in line.
  const withVim = (state: EditorState): EditorState => {
    if (vimCompartment.get(state) === undefined || isVimOn(state) === vimOn) return state
    return state.update({ effects: vimCompartment.reconfigure(vimFor(vimOn)) }).state
  }

  const baseExtensions: Extension[] = [
    vimCompartment.of([]),
    history(),
    drawSelection(),
    lineNumbers(),
    diffGutter,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightSelectionMatches(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    language.of([]),
    editorTheme,
    EditorView.contentAttributes.of({ 'aria-label': 'Editor', spellcheck: 'false' }),
    EditorView.updateListener.of((u) => onUpdate?.(u)),
    ...extensions,
  ]
  const createState = (d: string) =>
    withVim(EditorState.create({ doc: d, extensions: baseExtensions }))

  const view = new EditorView({ parent, state: createState(doc) })

  const setLanguage = async (nameOrFile: string | null) => {
    const req = ++langRequest
    const loaded = nameOrFile ? await loadLanguage(nameOrFile) : null
    // Drop stale results if another request started or the view is gone.
    if (req !== langRequest || !view.dom.isConnected) return loaded?.name ?? null
    view.dispatch({ effects: language.reconfigure(loaded?.extension ?? []) })
    return loaded?.name ?? null
  }

  if (filename) void setLanguage(filename)

  return {
    view,
    setLanguage,
    createState,
    setState: (state) => {
      langRequest++ // a pending language load belongs to the old state
      view.setState(withVim(state))
    },
    setVim: (on) => {
      vimOn = on
      if (isVimOn(view.state) === on) return
      view.dispatch({ effects: vimCompartment.reconfigure(vimFor(on)) })
    },
    destroy: () => view.destroy(),
  }
}
