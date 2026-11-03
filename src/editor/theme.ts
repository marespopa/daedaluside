import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// Monochrome: hierarchy comes from weight, style and opacity, never hue.
// Colors are CSS variables, so light/dark switches without rebuilding the editor.
const highlight = HighlightStyle.define([
  { tag: [t.comment, t.docComment], color: 'var(--muted)', fontStyle: 'italic' },
  {
    tag: [
      t.keyword,
      t.modifier,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
    ],
    fontWeight: '500',
  },
  { tag: [t.string, t.regexp, t.special(t.string)], color: 'var(--muted)' },
  {
    tag: [t.number, t.bool, t.null, t.atom],
    color: 'var(--muted)',
    fontWeight: '500',
  },
  {
    tag: [
      t.definition(t.variableName),
      t.function(t.variableName),
      t.className,
      t.typeName,
    ],
    fontWeight: '500',
    textDecoration: 'underline',
    textDecorationColor: 'var(--line)',
    textUnderlineOffset: '3px',
  },
  { tag: [t.heading], fontWeight: '500' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '500' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: [t.punctuation, t.bracket, t.operator], color: 'var(--muted)' },
  { tag: t.invalid, textDecoration: 'underline wavy' },
])

const base = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--text-base)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.625',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    maxWidth: 'var(--editor-max-width, 72ch)',
    margin: '0 auto',
    padding: '12vh 1.5rem 40vh',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    {
      backgroundColor:
        'color-mix(in srgb, var(--accent) var(--selection-mix), transparent)',
    },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'transparent',
    outline: '1px solid var(--muted)',
  },
  '.cm-nonmatchingBracket': { color: 'var(--text)', textDecoration: 'underline wavy' },
  '.cm-searchMatch': {
    backgroundColor:
      'color-mix(in srgb, var(--accent) var(--selection-mix), transparent)',
    outline: '1px solid var(--line)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor:
      'color-mix(in srgb, var(--accent) var(--selection-mix), transparent)',
    outline: '1px solid var(--text)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    borderColor: 'var(--line)',
  },
  '.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-panel.cm-search': { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    color: 'var(--text)',
    background: 'transparent',
    border: '1px solid var(--line)',
    borderRadius: '2px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--line)',
  },
})

export const monochromeTheme = [base, syntaxHighlighting(highlight)]
