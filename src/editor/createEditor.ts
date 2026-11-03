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
import { drawSelection, EditorView, keymap, type ViewUpdate } from '@codemirror/view'
import { loadLanguage } from './languages'
import { monochromeTheme } from './theme'

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

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
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
        monochromeTheme,
        EditorView.contentAttributes.of({ 'aria-label': 'Editor', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => onUpdate?.(u)),
        ...extensions,
      ],
    }),
  })

  const setLanguage = async (nameOrFile: string | null) => {
    const req = ++langRequest
    const loaded = nameOrFile ? await loadLanguage(nameOrFile) : null
    // Drop stale results if another request started or the view is gone.
    if (req !== langRequest || !view.dom.isConnected) return loaded?.name ?? null
    view.dispatch({ effects: language.reconfigure(loaded?.extension ?? []) })
    return loaded?.name ?? null
  }

  if (filename) void setLanguage(filename)

  return { view, setLanguage, destroy: () => view.destroy() }
}
