import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

const PATH_CHAR = /[\w@~./+-]/
const TRAILING = /[.,:;)\]}'"`]+$/

/**
 * The path-like token around `offset` in `line` (e.g. `src/a/b.ts` in
 * "see `src/a/b.ts`."), or null. A token needs a `.` or `/` so plain words never
 * count, and URLs are skipped.
 */
export function pathAt(line: string, offset: number): string | null {
  return pathRangeAt(line, offset)?.ref ?? null
}

/** Like `pathAt`, with the token's start and end offsets in the line. */
export function pathRangeAt(
  line: string,
  offset: number,
): { from: number; to: number; ref: string } | null {
  let from = offset
  let to = offset
  while (from > 0 && PATH_CHAR.test(line[from - 1]!)) from--
  while (to < line.length && PATH_CHAR.test(line[to]!)) to++
  const token = line.slice(from, to).replace(TRAILING, '')
  if (!token || offset > from + token.length) return null
  if (token.startsWith('//') && /[a-z]:$/i.test(line.slice(0, from))) return null
  if (!/[./]/.test(token) || /^\.+$/.test(token)) return null
  return { from, to: from + token.length, ref: token }
}

/** Resolves `.`/`..` against `dir`; null when it escapes the workspace root. */
function resolveFrom(dir: string, ref: string): string | null {
  const out = dir === '' ? [] : dir.split('/')
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(seg)
  }
  return out.length ? out.join('/') : null
}

export const isMarkdownPath = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

const EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'json', 'css']
const JS_TO_TS: Record<string, string[]> = {
  js: ['ts', 'tsx'],
  jsx: ['tsx'],
  mjs: ['mts'],
  cjs: ['cts'],
}

/** A module specifier may omit its extension or name a folder: the files it could be. */
function withExtensions(path: string): string[] {
  const out = [path]
  const m = /^(.*)\.(js|jsx|mjs|cjs)$/.exec(path)
  if (m) out.push(...JS_TO_TS[m[2]!]!.map((ext) => `${m[1]}.${ext}`))
  out.push(...EXTENSIONS.map((ext) => `${path}.${ext}`))
  out.push(...EXTENSIONS.map((ext) => `${path}/index.${ext}`))
  return out
}

/**
 * Workspace paths a reference in the file `from` could mean, best guess first. In
 * markdown any path-like text counts: relative to that file's folder, then to the root.
 * In other files only relative specifiers (`./x`, `../x`) do, as in imports, and a
 * missing extension or a folder resolves like a module (`./x` -> `x.ts`, `x/index.ts`).
 */
export function pathCandidates(ref: string, from: string): string[] {
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const relative = ref.startsWith('./') || ref.startsWith('../')
  const markdown = isMarkdownPath(from)
  if (!markdown && !relative) return []
  const bases: (string | null)[] = ref.startsWith('/')
    ? [resolveFrom('', ref)]
    : relative
      ? [resolveFrom(dir, ref)]
      : [resolveFrom(dir, ref), resolveFrom('', ref)]
  const list = bases.filter((p): p is string => p !== null)
  // Exact paths first, so `x.ts` beats a guessed `x.ts.ts` or a root-level match.
  return [...new Set([...list, ...list.flatMap(withExtensions)])]
}

export interface PathLinkOptions {
  /** Whether links are live for the current buffer. */
  enabled: () => boolean
  /** Called with the token under the pointer; it decides whether the file exists. */
  onOpen: (ref: string) => void
  /** Cheap, synchronous guess whether `ref` is a file, used for the hover effect. */
  exists?: (ref: string) => boolean
}

const setHover = StateEffect.define<{ from: number; to: number } | null>()
const hoverMark = Decoration.mark({ class: 'cm-path-link' })

const hoverField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setHover)) {
        return e.value
          ? Decoration.set([hoverMark.range(e.value.from, e.value.to)])
          : Decoration.none
      }
    }
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const linkTheme = EditorView.baseTheme({
  '.cm-path-link': {
    color: 'var(--syntax-function)',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
})

/**
 * Double-click, or Ctrl/Cmd+click, on a path-like token (a path in markdown, an import specifier in code) asks to open that file. While
 * Ctrl/Cmd is held, a token that looks openable is underlined and shows a pointer.
 */
export function pathLinks({ enabled, onOpen, exists }: PathLinkOptions): Extension {
  const find = (e: MouseEvent, view: EditorView) => {
    if (!enabled()) return null
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos === null) return null
    const line = view.state.doc.lineAt(pos)
    const hit = pathRangeAt(line.text, pos - line.from)
    return hit && { ...hit, from: line.from + hit.from, to: line.from + hit.to }
  }
  const handle = (e: MouseEvent, view: EditorView) => {
    const hit = find(e, view)
    if (!hit) return false
    onOpen(hit.ref)
    return true
  }
  let last: MouseEvent | null = null
  const refresh = (view: EditorView, e: MouseEvent | null, modifier: boolean) => {
    const hit = modifier && e ? find(e, view) : null
    const next =
      hit && (!exists || exists(hit.ref)) ? { from: hit.from, to: hit.to } : null
    const cur = view.state.field(hoverField).size > 0
    if (next || cur) view.dispatch({ effects: setHover.of(next) })
  }
  return [
    hoverField,
    linkTheme,
    EditorView.domEventHandlers({
      click: (e, view) => (e.ctrlKey || e.metaKey) && e.button === 0 && handle(e, view),
      dblclick: (e, view) => !(e.ctrlKey || e.metaKey) && handle(e, view),
      mousemove(e, view) {
        last = e
        refresh(view, e, e.ctrlKey || e.metaKey)
      },
      mouseleave: (_e, view) => refresh(view, null, false),
      keydown(e, view) {
        if (e.key === 'Control' || e.key === 'Meta') refresh(view, last, true)
      },
      keyup(e, view) {
        if (e.key === 'Control' || e.key === 'Meta') refresh(view, last, false)
      },
    }),
  ]
}
