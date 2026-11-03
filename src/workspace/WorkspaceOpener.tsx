import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { MOD_KEY_LABEL } from '../lib/platform'
import { openExPrompt } from '../editor/vimMode'
import { editorHandleAtom, paletteOpenAtom, vimEnabledAtom } from '../state/editorAtoms'
import {
  currentWorkspaceIdAtom,
  noticeAtom,
  settingsOpenAtom,
  treeAtom,
  workspacesAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import FileFinder from './FileFinder'
import { useController } from './useWorkspace'

const KEYMAP: { keys: string; label: string }[] = [
  { keys: `${MOD_KEY_LABEL}+K`, label: 'Command Palette' },
  { keys: `${MOD_KEY_LABEL}+P`, label: 'Search Files' },
  { keys: `${MOD_KEY_LABEL}+N`, label: 'New Scratch Buffer' },
  { keys: `${MOD_KEY_LABEL}+O`, label: 'Switch Workspace' },
]

/**
 * The blank page, shown when no file is open. A single quiet column on the canvas: no
 * cards, no borders. Typing starts an untitled file, so the page works like paper.
 */
export default function WorkspaceOpener() {
  const controller = useController()
  const store = useStore()
  const status = useAtomValue(workspaceStatusAtom)
  const workspaces = useAtomValue(workspacesAtom)
  const currentId = useAtomValue(currentWorkspaceIdAtom)
  const tree = useAtomValue(treeAtom)
  const [query, setQuery] = useState('')
  const setNotice = useSetAtom(noticeAtom)

  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const ready = status.state === 'ready'
  const current = workspaces.find((w) => w.id === currentId)
  const title = current?.name ?? 'daedalus'

  // A printable key on the blank page starts an untitled file, and the key goes into it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
      if (store.get(paletteOpenAtom) || store.get(settingsOpenAtom)) return
      // Only when nothing has focus: a key in the file tree or a dialog is not for this page.
      const focused = document.activeElement
      if (focused && focused !== document.body && focused !== document.documentElement)
        return
      if (store.get(workspaceStatusAtom).state !== 'ready') return
      if (e.key === ':' && store.get(vimEnabledAtom)) {
        const view = store.get(editorHandleAtom)?.view
        if (view && openExPrompt(view)) {
          e.preventDefault()
          return
        }
      }
      e.preventDefault()
      void controller.startUntitled(e.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, store])

  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const onDragEnter = (e: DragEvent) => {
    if (!isFileDrag(e)) return
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragLeave = (e: DragEvent) => {
    if (!isFileDrag(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDragOver = (e: DragEvent) => {
    // Always cancel: otherwise the browser may navigate to a dropped file.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (!isFileDrag(e) || files.length === 0) return
    const [file] = files
    if (!ready) {
      setNotice({
        kind: 'info',
        text: 'Storage is still starting. Try again in a moment.',
      })
      return
    }
    if (files.length !== 1 || !file!.name.toLowerCase().endsWith('.zip')) {
      setNotice({
        kind: 'error',
        text: 'Drop a single .zip archive to unpack it as a workspace.',
      })
      return
    }
    void controller.importZipFile(file!)
  }

  return (
    <section
      aria-label="Workspace opener"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="absolute inset-x-0 top-0 bottom-10 flex items-center justify-center overflow-y-auto bg-canvas px-6 font-sans text-text"
    >
      <div className="flex w-full max-w-[480px] flex-col items-center gap-8 py-12 text-center">
        <header className="space-y-2">
          <h2 className="text-sm font-medium text-text">{title}</h2>
          <p className="text-xs text-muted">
            Select a file or press {MOD_KEY_LABEL}+K to begin.
          </p>
        </header>

        <FileFinder
          tree={tree}
          value={query}
          onChange={setQuery}
          onOpen={(path) => void controller.openFile(path)}
          label="Search files"
          className="w-full"
          listClassName="max-h-56 overflow-auto px-2 pb-2"
        />

        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2 text-left text-xs text-muted">
          {KEYMAP.map((row) => (
            <div key={row.keys} className="contents">
              <dt>
                <kbd className="rounded bg-line/50 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                  {row.keys}
                </kbd>
              </dt>
              <dd>{row.label}</dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-muted">Drop a .zip here to import it</p>

        {status.state === 'loading' && (
          <p className="text-xs text-muted">Starting local storage…</p>
        )}
        {status.state === 'error' && (
          <p role="alert" className="text-xs text-diff-remove-fg">
            Storage unavailable: {status.message}
          </p>
        )}
      </div>

      {/* Drop target cue: fades in around the edges, never shifts the layout. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 border-[1.5px] border-dashed border-accent transition-opacity duration-200 ${
          dragging ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </section>
  )
}
