import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { getCM } from '@replit/codemirror-vim'
import { useAtomValue, useStore } from 'jotai'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { loadLanguage } from '../../editor/languages'
import { editorTheme } from '../../editor/theme'
import { openExPrompt, vimExtension } from '../../editor/vimMode'
import { vimEnabledAtom } from '../../state/editorAtoms'
import { treeProgressAtom, treeStatusAtom } from '../../state/workspaceAtoms'
import {
  branchConfirmAtom,
  branchMarksAtom,
  branchReviewAtom,
  branchStatsAtom,
} from '../../state/branchReviewAtoms'
import type { BranchFile } from '../../workspace/gitService'
import { useController } from '../../workspace/useWorkspace'
import { computeHunks, splitLines, type Hunk } from '../diff'
import {
  addReviewHunks,
  foldField,
  foldUnchanged,
  hunkAt,
  paneMode,
  reviewField,
  reviewTheme,
  setReviewHunks,
} from '../diffView'
import { streamDiff } from '../diffService'
import { getReviewPane, hunkAnchors, setReviewPane, stepHunk } from '../reviewPane'
import { Icon } from '../../ui'
import { isReviewed } from './marks'

/** The patch of the branch against its merge base, one file at a time. */
/** Texts longer than this (both sides together) are diffed in the worker, hunk by hunk. */
const STREAM_DIFF_CHARS = 200_000

export default function BranchReview() {
  const open = useAtomValue(branchReviewAtom) !== null
  return open ? <Surface /> : null
}

/** True while Vim is mid-command (a count, an operator, a visual selection, a `:` line). */
function vimBusy(view: EditorView): boolean {
  const cm = getCM(view)
  const vs = cm?.state.vim
  return (
    !!cm?.state.dialog ||
    !!vs?.visualMode ||
    !!vs?.insertMode ||
    !!vs?.inputState?.operator ||
    (vs?.inputState?.keyBuffer?.length ?? 0) > 0
  )
}

/** Every row of the file list has this height, so the visible window is plain arithmetic. */
const ROW_H = 20
/** Rows drawn beyond the viewport on each side, so a fast scroll never shows a gap. */
const OVERSCAN = 12
/** Used until the list has been measured (or while it is hidden). */
const FALLBACK_H = 800

interface Row {
  kind: 'dir' | 'file'
  depth: number
  name: string
  index: number
  file?: BranchFile
}

/** Directory headings and file rows, in path order (the files arrive sorted). */
function buildRows(files: readonly BranchFile[]): Row[] {
  const rows: Row[] = []
  let shown: string[] = []
  files.forEach((file, index) => {
    const parts = file.path.split('/')
    const dirs = parts.slice(0, -1)
    let common = 0
    while (
      common < shown.length &&
      common < dirs.length &&
      shown[common] === dirs[common]
    )
      common++
    for (let d = common; d < dirs.length; d++) {
      rows.push({ kind: 'dir', depth: d, name: `${dirs[d]}/`, index: -1 })
    }
    shown = dirs
    rows.push({
      kind: 'file',
      depth: dirs.length,
      name: parts[parts.length - 1]!,
      index,
      file,
    })
  })
  return rows
}

function Surface() {
  const store = useStore()
  const controller = useController()
  const s = useAtomValue(branchReviewAtom)!
  const marks = useAtomValue(branchMarksAtom)
  const confirm = useAtomValue(branchConfirmAtom)
  const treeLoading = useAtomValue(treeStatusAtom).state === 'loading'
  const progress = useAtomValue(treeProgressAtom)
  const host = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const language = useRef(new Compartment())
  const pendingS = useRef(0)
  const pendingHunk = useRef<Hunk | null>(null)
  const pendingBracket = useRef<{ dir: 1 | -1; at: number } | null>(null)
  const [diffing, setDiffing] = useState(false)
  const [placeholder, setPlaceholder] = useState<{
    text: string
    meta: string | null
  } | null>(null)

  const file: BranchFile | undefined = s.files[s.index]
  const rows = useMemo(() => buildRows(s.files), [s.files])
  /** Row position of each file, to scroll the selected one into view. */
  const rowOfFile = useMemo(() => {
    const at: number[] = []
    rows.forEach((r, i) => {
      if (r.kind === 'file') at[r.index] = i
    })
    return at
  }, [rows])
  const [view, setView] = useState({ top: 0, height: 0 })
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const read = () =>
      setView((v) =>
        v.top === el.scrollTop && v.height === el.clientHeight
          ? v
          : { top: el.scrollTop, height: el.clientHeight },
      )
    read()
    el.addEventListener('scroll', read, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', read)
      ro?.disconnect()
    }
  }, [])
  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN)
  const last = Math.min(
    rows.length,
    Math.ceil((view.top + (view.height || FALLBACK_H)) / ROW_H) + OVERSCAN,
  )
  const reviewedCount = s.files.filter((f) => isReviewed(marks, f)).length
  const onToggleRow = useCallback(
    (index: number, reviewed: boolean) =>
      controller.setBranchFileReviewed(index, reviewed),
    [controller],
  )
  const onSelectRow = useCallback(
    (index: number) => {
      controller.branchSelect(index)
      controller.setBranchFocus('index')
      list.current?.focus()
    },
    [controller],
  )

  const hunkUnderCursor = useCallback((): Hunk | null => {
    const view = viewRef.current
    if (!view) return null
    const { hunks } = view.state.field(reviewField)
    const anchors = hunkAnchors(hunks, view.state.doc.lines)
    const line = view.state.doc.lineAt(view.state.selection.main.head).number
    const i = hunkAt(anchors, hunks, line, true)
    return i === -1 ? null : hunks[i]!
  }, [])

  /** Runs one review key; returns false when the key is not the review's. */
  const press = useCallback(
    (key: string, from: 'index' | 'canvas'): boolean => {
      const cur = store.get(branchReviewAtom)
      if (!cur) return false
      const f = cur.files[cur.index]
      const pending = store.get(branchConfirmAtom)
      if (pending) {
        if (key === 'y' || key === 'Enter') {
          store.set(branchConfirmAtom, null)
          const target = cur.files.find((x) => x.path === pending.path)
          if (target && pending.kind === 'file') void controller.revertBranchFile(target)
          else if (target && pendingHunk.current)
            void controller.revertBranchHunk(target, pendingHunk.current)
        } else store.set(branchConfirmAtom, null)
        return true
      }
      if (pendingS.current && Date.now() - pendingS.current < 1000) {
        pendingS.current = 0
        const h = hunkUnderCursor()
        if (key === 'a' || key === 'r') {
          if (!h || !f)
            controller.notifyInfo('Move the cursor onto a changed hunk first.')
          else if (key === 'a')
            controller.approveBranchHunk(
              `${f.path}#${h.baseRange.start}:${h.newRange.start}`,
            )
          else {
            pendingHunk.current = h
            store.set(branchConfirmAtom, { kind: 'hunk', path: f.path })
          }
          return true
        }
        // Not a prefix of ours: fall through and treat the key normally.
      }
      pendingS.current = 0
      // `]c` / `[c` step hunks. With Vim on, the canvas leaves them to Vim's own mappings.
      if (pendingBracket.current && Date.now() - pendingBracket.current.at < 1000) {
        const dir = pendingBracket.current.dir
        pendingBracket.current = null
        if (key === 'c') {
          if (from === 'index') controller.setBranchFocus('canvas')
          getReviewPane()?.jump(dir)
          return true
        }
      }
      pendingBracket.current = null
      if (
        (key === ']' || key === '[') &&
        !(from === 'canvas' && store.get(vimEnabledAtom))
      ) {
        pendingBracket.current = { dir: key === ']' ? 1 : -1, at: Date.now() }
        return true
      }
      switch (key) {
        case 'q':
        case 'Escape':
          controller.closeBranchReview()
          return true
        case 'n':
        case 'L':
        case 'ArrowRight':
          if (from === 'canvas' && store.get(vimEnabledAtom) && key === 'ArrowRight')
            return false
          controller.branchStep(1)
          return true
        case 'p':
        case 'H':
        case 'ArrowLeft':
          if (from === 'canvas' && store.get(vimEnabledAtom) && key === 'ArrowLeft')
            return false
          controller.branchStep(-1)
          return true
        case 'c':
        case 'C':
        case 'Enter':
          if (from === 'canvas' && store.get(vimEnabledAtom) && key === 'Enter')
            return false
          // Toggle: approving moves on to the next file; on a reviewed file it takes the approval back.
          controller.toggleBranchReviewed()
          return true
        case 'a':
        case ' ':
          controller.toggleBranchReviewed()
          return true
        case 'r':
        case 'X':
          if (f) store.set(branchConfirmAtom, { kind: 'file', path: f.path })
          return true
        case 'w':
        case 'W':
          controller.toggleBranchMode()
          return true
        case 'e':
          if (f) void controller.editBranchFile(f.path)
          return true
        case 's':
          if (from !== 'canvas') return false
          pendingS.current = Date.now()
          return true
        case 'j':
        case 'ArrowDown':
          if (from !== 'index') return false
          controller.branchStep(1)
          return true
        case 'k':
        case 'ArrowUp':
          if (from !== 'index') return false
          controller.branchStep(-1)
          return true
        case ':':
          if (from !== 'index' || !viewRef.current) return false
          return openExPrompt(viewRef.current)
        default:
          return false
      }
    },
    [controller, store, hunkUnderCursor],
  )
  const pressRef = useRef(press)
  useEffect(() => {
    pressRef.current = press
  }, [press])

  // One read-only unified view, created with the surface; its document follows the selected file.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: '',
        extensions: [
          reviewField,
          foldField,
          paneMode.of('unified'),
          reviewTheme,
          lineNumbers(),
          editorTheme,
          language.current.of([]),
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Branch patch' }),
          Prec.highest(
            EditorView.domEventHandlers({
              keydown(e, v) {
                if (e.ctrlKey || e.metaKey || e.altKey) return false
                if (vimBusy(v)) return false
                const handled = pressRef.current(e.key, 'canvas')
                if (handled) e.preventDefault()
                return handled
              },
            }),
          ),
          ...(store.get(vimEnabledAtom) ? [vimExtension] : []),
        ],
      }),
    })
    viewRef.current = view
    const hunksAndAnchors = () => {
      const { hunks } = view.state.field(reviewField)
      return { hunks, anchors: hunkAnchors(hunks, view.state.doc.lines) }
    }
    setReviewPane({
      view,
      act(action) {
        // dp approves the hunk; the other git actions have no meaning against a base branch.
        if (action !== 'put') return
        const h = hunkUnderCursor()
        const f = store.get(branchReviewAtom)
        const cur = f?.files[f.index]
        if (h && cur)
          controller.approveBranchHunk(
            `${cur.path}#${h.baseRange.start}:${h.newRange.start}`,
          )
      },
      jump(delta) {
        const { anchors } = hunksAndAnchors()
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
        const { anchors } = hunksAndAnchors()
        if (anchors.length === 0) return null
        return anchors[which === 'first' ? 0 : anchors.length - 1]! - 1
      },
    })
    return () => {
      setReviewPane(null)
      viewRef.current = null
      view.destroy()
      el.replaceChildren()
    }
  }, [store, controller, hunkUnderCursor])

  // Show the selected file's patch.
  const path = file?.path
  const mbOid = file?.mbOid
  const headOid = file?.headOid
  useEffect(() => {
    const view = viewRef.current
    if (!view || !file) return
    let stale = false
    let stop: (() => void) | null = null
    setDiffing(false)
    void controller
      .branchFileContent(file)
      .then(async (c) => {
        if (stale || viewRef.current !== view) return
        const replace = (doc: string, hunks: Hunk[], base: string[]) =>
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: doc },
            selection: { anchor: 0 },
            effects: setReviewHunks.of({ hunks, base }),
          })
        if ('placeholder' in c) {
          setPlaceholder({ text: c.placeholder, meta: null })
          replace('', [], [])
          return
        }
        setPlaceholder(null)
        const base = splitLines(c.base)
        if (c.base.length + c.current.length <= STREAM_DIFF_CHARS) {
          const hunks = computeHunks(c.base, c.current)
          replace(c.current, hunks, base)
          view.dispatch({ effects: foldUnchanged.of(hunks) })
          return
        }
        // A big file: show it at once and let the hunks arrive from the worker.
        replace(c.current, [], base)
        setDiffing(true)
        stop = streamDiff(
          c.base,
          c.current,
          (hunks) => {
            if (stale || viewRef.current !== view) return
            view.dispatch({ effects: addReviewHunks.of({ hunks, base }) })
          },
          () => {
            if (stale || viewRef.current !== view) return
            setDiffing(false)
            view.dispatch({
              effects: foldUnchanged.of(view.state.field(reviewField).hunks),
            })
          },
        )
      })
      .catch(() => {
        if (!stale) setPlaceholder({ text: '[Could not read this file]', meta: null })
      })
    void loadLanguage(file.path).then((l) => {
      if (!stale && viewRef.current === view) {
        view.dispatch({ effects: language.current.reconfigure(l?.extension ?? []) })
      }
    })
    return () => {
      stale = true
      stop?.()
      setDiffing(false)
    }
    // The oids name the content; `file` itself changes identity with every stats update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, path, mbOid, headOid])

  // Focus follows the index/canvas choice (Ctrl-W w flips it).
  useEffect(() => {
    if (s.status !== 'ready') return
    if (s.focus === 'canvas') viewRef.current?.focus()
    else list.current?.focus()
  }, [s.focus, s.status])

  // Keep the selected row in view; its element may not be drawn, so scroll by position.
  useEffect(() => {
    const el = list.current
    const at = rowOfFile[s.index]
    if (!el || at === undefined || el.clientHeight === 0) return
    const y = at * ROW_H + 4 // the list has 4px of padding above the first row
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = y + ROW_H - el.clientHeight
  }, [s.index, rowOfFile])

  const inspect = async () => {
    if (!file) return
    setPlaceholder((p) => (p ? { ...p, meta: 'Reading…' } : p))
    const meta = await controller.branchFileMeta(file)
    setPlaceholder((p) => (p ? { ...p, meta } : p))
  }

  const body =
    s.status === 'loading' ? (
      <div
        role="status"
        aria-label="Reading branch"
        className="animate-pulse p-3 font-mono text-xs"
      >
        <p className="mb-3 text-muted">
          {treeLoading ? 'Opening workspace… ' : 'Reading changes… '}
          {treeLoading && progress
            ? `${progress.done}${progress.total ? ` / ${progress.total}` : ''} files`
            : ''}
        </p>
        {[60, 85, 45, 70, 55, 80].map((w, i) => (
          <div
            key={i}
            className="mb-2 h-3 rounded bg-surface"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    ) : s.status === 'error' ? (
      <p role="alert" className="p-4 font-sans text-sm text-muted">
        {s.message}
      </p>
    ) : s.files.length === 0 ? (
      <p role="status" className="p-4 font-sans text-sm text-muted">
        {s.mode === 'working'
          ? 'Working tree is clean: no uncommitted changes.'
          : `No differences from ${s.base}, committed or uncommitted.`}
      </p>
    ) : null

  const confirming = confirm
    ? confirm.kind === 'file'
      ? `Revert ${confirm.path} to base? y / n`
      : `Revert this hunk in ${confirm.path} to base? y / n`
    : null

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col bg-canvas"
      data-testid="branch-review"
    >
      <header className="flex h-9 shrink-0 items-center gap-3 px-3 font-mono text-xs text-muted">
        <button
          type="button"
          onClick={() => controller.toggleBranchMode()}
          className="shrink-0 hover:text-text"
          title="Toggle working-tree diff / diff with base (w)"
        >
          {s.mode === 'working' ? 'working tree' : `vs ${s.base}`}
        </button>
        <span className="min-w-0 truncate text-text">{file?.path}</span>
        {confirming ? (
          <span role="alert" className="ml-auto shrink-0 text-text">
            {confirming}
          </span>
        ) : (
          <span className="ml-auto flex shrink-0 gap-3">
            <Totals partial={s.partial === true} ready={s.status === 'ready'} />
            <span data-testid="branch-progress">
              {reviewedCount} / {s.files.length} reviewed
            </span>
          </span>
        )}
      </header>
      {body && <div className="min-h-0 flex-1 overflow-auto">{body}</div>}
      {
        // Always mounted, so the patch view exists before the branch has loaded.
        <div
          className={`min-h-0 flex-1 flex-col md:flex-row ${body ? 'hidden' : 'flex'}`}
        >
          <div
            ref={list}
            tabIndex={0}
            role="listbox"
            aria-label="Branch files"
            className="max-h-[35%] w-full shrink-0 overflow-auto py-1 font-mono text-xs outline-none md:max-h-none md:w-[260px] md:border-r md:border-line"
            onKeyDown={(e) => {
              if (e.ctrlKey || e.metaKey || e.altKey) return
              if (pressRef.current(e.key, 'index')) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            onFocus={() =>
              store.get(branchReviewAtom)?.focus !== 'index' &&
              controller.setBranchFocus('index')
            }
          >
            <div aria-hidden style={{ height: first * ROW_H }} />
            {rows.slice(first, last).map((r, k) =>
              r.kind === 'dir' ? (
                <div
                  key={`d${first + k}`}
                  className="truncate text-muted"
                  style={{
                    height: ROW_H,
                    lineHeight: `${ROW_H}px`,
                    paddingLeft: `${0.75 + r.depth}rem`,
                  }}
                >
                  {r.name}
                </div>
              ) : (
                <FileRow
                  key={r.file!.path}
                  row={r}
                  total={s.files.length}
                  active={r.index === s.index}
                  reviewed={isReviewed(marks, r.file!)}
                  onToggle={onToggleRow}
                  onSelect={onSelectRow}
                />
              ),
            )}
            <div aria-hidden style={{ height: (rows.length - last) * ROW_H }} />
          </div>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {placeholder && (
              <div className="p-4 font-sans text-sm text-muted">
                <button
                  type="button"
                  className="text-left underline-offset-2 hover:underline"
                  onClick={inspect}
                >
                  {placeholder.text}
                </button>
                {placeholder.meta && (
                  <p className="mt-2 font-mono text-xs">{placeholder.meta}</p>
                )}
              </div>
            )}
            {diffing && (
              <p role="status" className="px-3 py-1 font-sans text-xs text-muted">
                Computing diff…
              </p>
            )}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${placeholder ? 'hidden' : ''}`}
            >
              <div
                ref={host}
                className="h-full w-full"
                onFocusCapture={() =>
                  store.get(branchReviewAtom)?.focus !== 'canvas' &&
                  controller.setBranchFocus('canvas')
                }
              />
            </div>
          </section>
        </div>
      }
    </div>
  )
}

/** Sums the line totals itself, so a stats patch re-renders this span, not the whole surface. */
const Totals = memo(function Totals({
  partial,
  ready,
}: {
  partial: boolean
  ready: boolean
}) {
  const { stats, done } = useAtomValue(branchStatsAtom)
  const reading = (partial || !done) && ready
  const { add, del } = useMemo(() => {
    let a = 0
    let d = 0
    for (const st of Object.values(stats)) {
      a += st.add
      d += st.del
    }
    return { add: a, del: d }
  }, [stats])
  return (
    <span data-testid="branch-totals">
      {done ? `+${add} -${del}` : '…'}
      {reading && ' · reading'}
    </span>
  )
})

const FileRow = memo(function FileRow({
  row,
  total,
  active,
  reviewed,
  onSelect,
  onToggle,
}: {
  row: Row
  total: number
  active: boolean
  reviewed: boolean
  onSelect: (index: number) => void
  onToggle: (index: number, reviewed: boolean) => void
}) {
  const f = row.file!
  return (
    <div
      role="option"
      aria-selected={active}
      aria-setsize={total}
      aria-posinset={row.index + 1}
      aria-current={active}
      data-reviewed={reviewed}
      onClick={() => onSelect(row.index)}
      className={`relative flex cursor-pointer items-center gap-2 truncate pr-3 ${
        active ? 'bg-surface' : ''
      } ${reviewed ? 'text-muted' : 'text-text'}`}
      style={{ height: ROW_H, paddingLeft: `${0.75 + row.depth}rem` }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={reviewed}
        aria-label={`Reviewed: ${f.path}`}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          onToggle(row.index, !reviewed)
        }}
        className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
          reviewed
            ? 'border-muted text-muted'
            : 'border-muted text-transparent hover:text-muted/50'
        }`}
      >
        <Icon name="check" className="size-2.5" />
      </button>
      <span
        className={`truncate ${
          reviewed
            ? ''
            : f.status === 'A'
              ? 'text-diff-add-fg'
              : f.status === 'D'
                ? 'text-diff-remove-fg'
                : ''
        }`}
      >
        {row.name}
      </span>
    </div>
  )
})
