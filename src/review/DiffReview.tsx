import { EditorState, Prec, Compartment, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
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
import {
  hunkAt,
  paneMode,
  reviewField,
  reviewTheme,
  setReviewHunks,
  splitTheme,
  type PaneMode,
} from './diffView'
import { hunkAnchors, reviewKeys, setReviewPane, stepHunk } from './reviewPane'

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
