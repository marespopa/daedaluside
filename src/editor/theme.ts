import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// Code colors come from the per-theme --syntax-* tokens (src/styles/tokens.css), so a
// theme switch recolors the code without rebuilding the editor. Every token meets AA
// on the canvas and surface, which the token tests check.
const highlight = HighlightStyle.define([
  { tag: [t.comment, t.docComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  {
    tag: [
      t.keyword,
      t.modifier,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.self,
      t.tagName,
    ],
    color: 'var(--syntax-keyword)',
  },
  {
    tag: [t.string, t.regexp, t.special(t.string)],
    color: 'var(--syntax-string)',
  },
  {
    tag: [t.number, t.bool, t.null, t.atom],
    color: 'var(--syntax-number)',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: 'var(--syntax-function)',
  },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syntax-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syntax-property)' },
  { tag: t.meta, color: 'var(--syntax-comment)' },
  { tag: t.heading, color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.link, color: 'var(--syntax-function)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--diff-remove-fg)', textDecoration: 'underline wavy' },
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
    lineHeight: '1.65',
    overflow: 'auto',
  },
  // Centered column whose width and gutters come from the breakpoints in index.css.
  '.cm-content': {
    caretColor: 'var(--accent)',
    boxSizing: 'border-box',
    maxWidth: 'var(--editor-max-width)',
    margin: '0 auto',
    padding: '3rem var(--editor-gutter)',
  },
  // Faint, low-contrast gutter. Hidden in focus mode (see focusMode.ts, Phase 4).
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--muted)',
    opacity: '0.7',
    fontSize: 'var(--text-xs)',
  },
  '.cm-gutterElement': { padding: '0 0.75rem 0 0.5rem' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
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
  // Spec: active line is a subtle surface fill (bg-surface/50).
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--surface) 50%, transparent)',
  },
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

export const editorTheme = [base, syntaxHighlighting(highlight)]
