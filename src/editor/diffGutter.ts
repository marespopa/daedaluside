import { type Extension, type Range, RangeSet, StateEffect, StateField } from '@codemirror/state'
import { EditorView, gutter, GutterMarker } from '@codemirror/view'
import type { Hunk } from '../review/diff'

/** Replaces the hunks shown in the gutter. */
export const setHunks = StateEffect.define<readonly Hunk[]>()

/** The hunks of this buffer against HEAD. Lives in the state, so it follows a buffer swap. */
export const hunksField = StateField.define<readonly Hunk[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHunks)) return e.value
    return value
  },
})

class BarMarker extends GutterMarker {
  readonly kind: 'add' | 'change'
  constructor(kind: 'add' | 'change') {
    super()
    this.kind = kind
  }
  override eq(other: GutterMarker) {
    return other instanceof BarMarker && other.kind === this.kind
  }
  override toDOM() {
    const el = document.createElement('div')
    el.className = `cm-diff-mark cm-diff-${this.kind}`
    el.dataset.diff = this.kind
    return el
  }
}

class RemoveMarker extends GutterMarker {
  override eq(other: GutterMarker) {
    return other instanceof RemoveMarker
  }
  override toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-diff-mark cm-diff-remove'
    el.dataset.diff = 'remove'
    el.textContent = '▲'
    return el
  }
}

/** Reserves the gutter's width before any mark exists. */
const SPACER = new (class extends GutterMarker {})()
const ADD = new BarMarker('add')
const CHANGE = new BarMarker('change')
const REMOVE = new RemoveMarker()

function markersFor(view: EditorView) {
  const doc = view.state.doc
  const ranges: Range<GutterMarker>[] = []
  for (const h of view.state.field(hunksField)) {
    if (h.kind === 'remove') {
      // The gap sits before `newRange.start`; mark the line after it (the last line at EOF).
      const n = Math.min(h.newRange.start + 1, doc.lines)
      ranges.push(REMOVE.range(doc.line(n).from))
      continue
    }
    const first = h.newRange.start + 1
    const last = Math.min(h.newRange.start + h.newRange.count, doc.lines)
    for (let n = first; n <= last; n++) {
      ranges.push((h.kind === 'add' ? ADD : CHANGE).range(doc.line(n).from))
    }
  }
  return RangeSet.of(ranges, true)
}

const diffTheme = EditorView.baseTheme({
  '.cm-diff-gutter': { width: '6px' },
  '.cm-diff-gutter .cm-gutterElement': { padding: '0', display: 'flex' },
  '.cm-diff-mark.cm-diff-add, .cm-diff-mark.cm-diff-change': {
    width: '2px',
    height: '100%',
    marginLeft: '2px',
  },
  '.cm-diff-mark.cm-diff-add': { backgroundColor: 'var(--diff-add-fg)' },
  '.cm-diff-mark.cm-diff-change': { backgroundColor: 'var(--diff-change-fg)' },
  '.cm-diff-mark.cm-diff-remove': {
    color: 'var(--diff-remove-fg)',
    fontSize: '6px',
    lineHeight: '1',
    alignSelf: 'flex-start',
  },
})

/** A thin gutter: 2px bars for added and changed lines, a triangle where lines were deleted. */
export const diffGutter: Extension = [
  hunksField,
  gutter({
    class: 'cm-diff-gutter',
    markers: markersFor,
    // Redraw when the hunks change or the document shifts lines under them.
    lineMarkerChange: (u) =>
      u.docChanged || u.startState.field(hunksField) !== u.state.field(hunksField),
    initialSpacer: () => SPACER,
  }),
  diffTheme,
]
