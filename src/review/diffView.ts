import {
  EditorState,
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Range,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import type { Hunk } from './diff'

/** A run of lines deleted from HEAD, shown read-only above the line that replaced them. */
class DeletedLines extends WidgetType {
  readonly lines: readonly string[]
  constructor(lines: readonly string[]) {
    super()
    this.lines = lines
  }
  override eq(other: WidgetType) {
    return (
      other instanceof DeletedLines &&
      other.lines.length === this.lines.length &&
      other.lines.every((l, i) => l === this.lines[i])
    )
  }
  override toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-diff-deleted'
    el.dataset.diff = 'remove'
    el.setAttribute('aria-label', 'Deleted lines')
    for (const line of this.lines) {
      const row = document.createElement('div')
      row.className = 'cm-diff-deleted-line'
      row.textContent = line === '' ? ' ' : line
      el.appendChild(row)
    }
    return el
  }
  override ignoreEvent() {
    return false
  }
}

/** Blank rows that keep the two halves of the split view level where one side has fewer lines. */
class Spacer extends WidgetType {
  readonly rows: number
  constructor(rows: number) {
    super()
    this.rows = rows
  }
  override eq(other: WidgetType) {
    return other instanceof Spacer && other.rows === this.rows
  }
  override toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-diff-spacer'
    el.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < this.rows; i++) {
      const row = document.createElement('div')
      row.textContent = '\u00a0'
      el.appendChild(row)
    }
    return el
  }
  override ignoreEvent() {
    return true
  }
}

/** How a review document shows the hunks: one merged document, or one half of the split view. */
export type PaneMode = 'unified' | 'left' | 'right'
export const paneMode = Facet.define<PaneMode, PaneMode>({
  combine: (v) => v[0] ?? 'unified',
})

export const setReviewHunks = StateEffect.define<{
  hunks: readonly Hunk[]
  base: readonly string[]
}>()

/** One half of the split view: tinted hunk lines, and spacers where the other half has more lines. */
function decorateSplit(doc: EditorState['doc'], hunks: readonly Hunk[], side: 'left' | 'right') {
  const out: Range<Decoration>[] = []
  for (const h of hunks) {
    const own = side === 'left' ? h.baseRange : h.newRange
    const other = side === 'left' ? h.newRange : h.baseRange
    const cls =
      h.kind === 'change'
        ? 'cm-diff-line-change'
        : side === 'left'
          ? 'cm-diff-line-remove'
          : 'cm-diff-line-add'
    const last = Math.min(own.start + own.count, doc.lines)
    for (let n = own.start + 1; n <= last; n++) {
      out.push(Decoration.line({ class: cls }).range(doc.line(n).from))
    }
    if (other.count > own.count) {
      const at = own.start + own.count + 1
      const inside = at <= doc.lines
      const pos = inside ? doc.line(at).from : doc.length
      out.push(
        Decoration.widget({
          widget: new Spacer(other.count - own.count),
          block: true,
          side: inside ? -1 : 1,
        }).range(pos),
      )
    }
  }
  return Decoration.set(out, true)
}

function decorate(
  doc: EditorState['doc'],
  hunks: readonly Hunk[],
  base: readonly string[],
  mode: PaneMode = 'unified',
) {
  if (mode !== 'unified') return decorateSplit(doc, hunks, mode)
  const b = new RangeSetBuilder<Decoration>()
  for (const h of hunks) {
    // The gap of a pure deletion sits before `newRange.start`; the end of the file takes the widget after its last line.
    const at = h.newRange.start + 1
    if (h.baseRange.count > 0) {
      const lines = base.slice(h.baseRange.start, h.baseRange.start + h.baseRange.count)
      const inside = at <= doc.lines
      const pos = inside ? doc.line(at).from : doc.length
      b.add(
        pos,
        pos,
        Decoration.widget({
          widget: new DeletedLines(lines),
          block: true,
          side: inside ? -1 : 1,
        }),
      )
    }
    // Lines added or rewritten take the tint; the line decorations follow the widget at the same offset.
    const last = Math.min(h.newRange.start + h.newRange.count, doc.lines)
    for (let n = at; n <= last && h.newRange.count > 0; n++) {
      const from = doc.line(n).from
      b.add(
        from,
        from,
        Decoration.line({
          class: h.kind === 'add' ? 'cm-diff-line-add' : 'cm-diff-line-change',
        }),
      )
    }
  }
  return b.finish()
}

export const reviewField = StateField.define<{
  hunks: readonly Hunk[]
  decorations: DecorationSet
}>({
  create: () => ({ hunks: [], decorations: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setReviewHunks)) {
        return {
          hunks: e.value.hunks,
          decorations: decorate(
            tr.state.doc,
            e.value.hunks,
            e.value.base,
            tr.state.facet(paneMode),
          ),
        }
      }
    }
    return tr.docChanged
      ? { ...value, decorations: value.decorations.map(tr.changes) }
      : value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
})

const TINT = (fg: string, pct = 10) =>
  `color-mix(in srgb, var(${fg}) ${pct}%, var(--canvas))`

export const reviewTheme = EditorView.theme({
  '.cm-diff-line-add': { backgroundColor: TINT('--diff-add-fg') },
  '.cm-diff-line-change': { backgroundColor: TINT('--diff-change-fg') },
  '.cm-diff-line-remove': { backgroundColor: TINT('--diff-remove-fg') },
  '.cm-diff-deleted': {
    backgroundColor: TINT('--diff-remove-fg'),
    userSelect: 'none',
    cursor: 'default',
  },
  '.cm-diff-deleted-line': {
    padding: '0 var(--editor-gutter, 1rem)',
    color: 'var(--muted)',
    whiteSpace: 'pre-wrap',
    textDecoration: 'line-through',
    textDecorationColor: 'color-mix(in srgb, var(--diff-remove-fg) 50%, transparent)',
  },
  '.cm-gutters': { borderRight: '1px solid var(--line)', backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  // Diffs use the full width of the pane, not the editor's centred prose column.
  '.cm-content': { maxWidth: 'none', margin: '0', padding: '0.5rem 0' },
})

/** The split view's fills are a touch stronger, and its halves have no centred column. */
export const splitTheme = EditorView.theme({
  '.cm-diff-line-add': { backgroundColor: TINT('--diff-add-fg', 12) },
  '.cm-diff-line-change': { backgroundColor: TINT('--diff-change-fg', 12) },
  '.cm-diff-line-remove': { backgroundColor: TINT('--diff-remove-fg', 12) },
  '.cm-content': { maxWidth: 'none', margin: '0', padding: '0.5rem 0' },
  '.cm-diff-spacer': { userSelect: 'none', whiteSpace: 'pre' },
})

/** The hunk the cursor is in, or (unless `strict`) the last one above it; -1 before the first. */
export function hunkAt(
  anchors: readonly number[],
  hunks: readonly Hunk[],
  line: number,
  strict = false,
): number {
  let found = -1
  for (let i = 0; i < hunks.length; i++) {
    const end = anchors[i]! + Math.max(hunks[i]!.newRange.count, 1) - 1
    if (anchors[i]! <= line) found = i
    if (line >= anchors[i]! && line <= end) return i
  }
  return strict ? -1 : found
}
