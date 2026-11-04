import {
  EditorState,
  Facet,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Compartment,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  lineNumbers,
  WidgetType,
} from '@codemirror/view'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { loadLanguage } from '../editor/languages'
import { editorTheme } from '../editor/theme'
import { vimExtension } from '../editor/vimMode'
import { getCM } from '@replit/codemirror-vim'
import { vimEnabledAtom } from '../state/editorAtoms'
import {
  activeHunkIndexAtom,
  gitHeadAtom,
  reviewLayoutAtom,
  reviewOpenAtom,
} from '../state/gitAtoms'
import { activePathAtom } from '../state/workspaceAtoms'
import { closeReview, useController } from '../workspace/useWorkspace'
import { computeHunks, splitLines, type Hunk } from './diff'
import { hunkAnchors, reviewKeys, setReviewPane, stepHunk } from './reviewPane'

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
type PaneMode = 'unified' | 'left' | 'right'
const paneMode = Facet.define<PaneMode, PaneMode>({
  combine: (v) => v[0] ?? 'unified',
})

const setReviewHunks = StateEffect.define<{
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

const reviewField = StateField.define<{
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

const reviewTheme = EditorView.theme({
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
})

/** The split view's fills are a touch stronger, and its halves have no centred column. */
const splitTheme = EditorView.theme({
  '.cm-diff-line-add': { backgroundColor: TINT('--diff-add-fg', 12) },
  '.cm-diff-line-change': { backgroundColor: TINT('--diff-change-fg', 12) },
  '.cm-diff-line-remove': { backgroundColor: TINT('--diff-remove-fg', 12) },
  '.cm-content': { maxWidth: 'none', margin: '0', padding: '0.5rem 0' },
  '.cm-diff-spacer': { userSelect: 'none', whiteSpace: 'pre' },
})

/** The hunk the cursor is in, or (unless `strict`) the last one above it; -1 before the first. */
function hunkAt(
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

/**
 * Overlay replacing the editor. Unified: the active file against HEAD as one read-only
 * document, deleted lines inline as widgets. Split: HEAD on the left and the working
 * tree on the right, scrolled together, with spacers keeping the hunks level.
 */
export default function DiffReview() {
  const open = useAtomValue(reviewOpenAtom)
  if (!open) return null
  return <ReviewPane />
}

interface Views {
  /** The view with the cursor: the merged document, or the working-tree half. */
  main: EditorView
  /** HEAD's half of the split view. */
  left: EditorView | null
}

/** Keeps two scrollers at the same offset; the echo of a programmatic scroll stops the loop. */
function linkScroll(a: HTMLElement, b: HTMLElement) {
  const follow = (from: HTMLElement, to: HTMLElement) => () => {
    if (to.scrollTop !== from.scrollTop) to.scrollTop = from.scrollTop
  }
  const ab = follow(a, b)
  const ba = follow(b, a)
  a.addEventListener('scroll', ab)
  b.addEventListener('scroll', ba)
  return () => {
    a.removeEventListener('scroll', ab)
    b.removeEventListener('scroll', ba)
  }
}

function ReviewPane() {
  const store = useStore()
  const controller = useController()
  const path = useAtomValue(activePathAtom)
  const version = useAtomValue(gitHeadAtom).version
  const layout = useAtomValue(reviewLayoutAtom)
  const vimOn = useAtomValue(vimEnabledAtom)
  const setActive = useSetAtom(activeHunkIndexAtom)
  const host = useRef<HTMLDivElement>(null)
  const viewsRef = useRef<Views | null>(null)
  const language = useRef(new Compartment())
  const [empty, setEmpty] = useState<string | null>(null)

  // The views live as long as the pane and its layout; their documents are replaced when the file or HEAD changes.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const split = layout === 'split'
    const cell = (extra = '') => {
      const d = document.createElement('div')
      d.className = `min-h-0 min-w-0 flex-1 overflow-hidden ${extra}`
      el.appendChild(d)
      return d
    }
    const syncActive = (view: EditorView) => {
      const { hunks } = view.state.field(reviewField)
      const line = view.state.doc.lineAt(view.state.selection.main.head).number
      setActive(hunkAt(hunkAnchors(hunks, view.state.doc.lines), hunks, line))
    }
    const common = (mode: PaneMode): Extension[] => [
      reviewField,
      paneMode.of(mode),
      reviewTheme,
      ...(split ? [splitTheme] : []),
      lineNumbers(),
      editorTheme,
      language.current.of([]),
      EditorState.readOnly.of(true),
      ...(split ? [] : [EditorView.lineWrapping]),
    ]
    let left: EditorView | null = null
    if (split) {
      left = new EditorView({
        parent: cell('border-r border-line'),
        state: EditorState.create({
          doc: '',
          extensions: [
            ...common('left'),
            EditorView.editable.of(false),
            EditorView.contentAttributes.of({ 'aria-label': 'HEAD' }),
          ],
        }),
      })
    }
    const view = new EditorView({
      parent: cell(),
      state: EditorState.create({
        doc: '',
        extensions: [
          ...common(split ? 'right' : 'unified'),
          EditorView.contentAttributes.of({ 'aria-label': 'Diff review' }),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) syncActive(u.view)
          }),
          // q and Escape close, unless Vim is mid-command (a count, a visual selection, a `:` line).
          EditorView.domEventHandlers({
            keydown(e, v) {
              if (e.ctrlKey || e.metaKey || e.altKey) return false
              if (e.key !== 'q' && e.key !== 'Escape') return false
              const cm = getCM(v)
              const vs = cm?.state.vim
              const busy =
                cm &&
                (!!cm.state.dialog ||
                  !!vs?.visualMode ||
                  !!vs?.insertMode ||
                  !!vs?.inputState?.operator ||
                  (vs?.inputState?.keyBuffer?.length ?? 0) > 0)
              if (busy) return false
              e.preventDefault()
              closeReview(store)
              return true
            },
          }),
          // Ahead of Vim, so s, <Space>, X and u act on the hunk here and nowhere else.
          Prec.highest(reviewKeys),
          ...(store.get(vimEnabledAtom) ? [vimExtension] : []),
        ],
      }),
    })
    const unlink = left ? linkScroll(left.scrollDOM, view.scrollDOM) : () => {}
    viewsRef.current = { main: view, left }
    setReviewPane({
      view,
      act(action) {
        const active = store.get(activePathAtom)
        if (active === null) return
        const { hunks } = view.state.field(reviewField)
        const anchors = hunkAnchors(hunks, view.state.doc.lines)
        const line = view.state.doc.lineAt(view.state.selection.main.head).number
        const i = hunkAt(anchors, hunks, line, true)
        void controller.reviewAction(active, action, i === -1 ? null : hunks[i]!)
      },
      jump(delta) {
        const { hunks } = view.state.field(reviewField)
        const anchors = hunkAnchors(hunks, view.state.doc.lines)
        const line = view.state.doc.lineAt(view.state.selection.main.head).number
        const i = stepHunk(anchors, line, delta)
        if (i === -1) return
        const pos = view.state.doc.line(anchors[i]!).from
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        })
      },
      edge(which) {
        const { hunks } = view.state.field(reviewField)
        if (hunks.length === 0) return null
        const anchors = hunkAnchors(hunks, view.state.doc.lines)
        return anchors[which === 'first' ? 0 : anchors.length - 1]! - 1
      },
    })
    view.focus()
    return () => {
      unlink()
      setReviewPane(null)
      viewsRef.current = null
      setActive(-1)
      view.destroy()
      left?.destroy()
      el.replaceChildren()
    }
    // Vim is read once at mount; toggling it while reviewing takes effect next time.
  }, [store, controller, setActive, layout])

  useEffect(() => {
    const views = viewsRef.current
    if (!views || path === null) return
    const { main: view, left } = views
    const alive = () => viewsRef.current === views
    let stale = false
    void controller.reviewSnapshot(path).then((snap) => {
      if (stale || !alive()) return
      const replace = (v: EditorView, doc: string, hunks: Hunk[], base: string[]) =>
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: doc },
          selection: { anchor: 0 },
          effects: setReviewHunks.of({ hunks, base }),
        })
      if (!snap) {
        setEmpty(
          'No changes to show: this folder is not a git repository, or HEAD has no text for this file.',
        )
        replace(view, '', [], [])
        if (left) replace(left, '', [], [])
        return
      }
      const hunks = computeHunks(snap.base, snap.current)
      setEmpty(hunks.length === 0 ? 'No changes against HEAD.' : null)
      const base = splitLines(snap.base)
      // A changed doc and its hunks arrive together, so the decorations match the lines.
      if (left) replace(left, snap.base, hunks, base)
      replace(view, snap.current, hunks, base)
    })
    for (const v of left ? [view, left] : [view]) {
      void loadLanguage(path).then((l) => {
        if (!stale && alive()) v.dispatch({ effects: language.current.reconfigure(l?.extension ?? []) })
      })
    }
    return () => {
      stale = true
    }
  }, [controller, path, version, layout])

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col bg-canvas"
      data-testid="diff-review"
      data-layout={layout}
      data-diff-review=""
    >
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line px-3 font-mono text-xs text-muted">
        <span className="truncate">{path ?? 'No file'}</span>
        <span className="ml-auto shrink-0">{vimOn ? ']c [c ]f [f s X do dp q' : 's X · Esc closes'}</span>
      </div>
      {empty && (
        <p role="status" className="px-3 py-2 font-sans text-xs text-muted">
          {empty}
        </p>
      )}
      <div ref={host} className="flex min-h-0 flex-1" />
    </div>
  )
}
