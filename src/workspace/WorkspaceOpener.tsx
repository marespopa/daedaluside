import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useState } from 'react'
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
import { useFolderPicker } from './useFolderPicker'
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
  const { pick } = useFolderPicker()
  const store = useStore()
  const status = useAtomValue(workspaceStatusAtom)
  const workspaces = useAtomValue(workspacesAtom)
  const currentId = useAtomValue(currentWorkspaceIdAtom)
  const tree = useAtomValue(treeAtom)
  const [query, setQuery] = useState('')
  const setNotice = useSetAtom(noticeAtom)

  const ready = status.state === 'ready'
  const current = workspaces.find((w) => w.id === currentId)
  const hasWorkspace = currentId != null
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
      if (!hasWorkspace) return // no folder to write into yet
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
  }, [controller, store, hasWorkspace])

  const openFolder = async () => {
    if (!ready) {
      setNotice({
        kind: 'info',
        text: 'Storage is still starting. Try again in a moment.',
      })
      return
    }
    try {
      await pick()
    } catch (e) {
      setNotice({
        kind: 'error',
        text: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <section
      aria-label="Workspace opener"
      className="absolute inset-x-0 top-0 bottom-10 flex items-center justify-center overflow-y-auto bg-canvas px-6 font-sans text-text"
    >
      <div className="flex w-full max-w-[480px] flex-col items-center gap-8 py-12 text-center">
        <header className="space-y-2">
          <h2 className="text-sm font-medium text-text">{title}</h2>
          <p className="text-xs text-muted">
            {hasWorkspace
              ? `Select a file or press ${MOD_KEY_LABEL}+K to begin.`
              : 'Open a folder to start editing.'}
          </p>
        </header>

        {hasWorkspace ? (
          <FileFinder
            tree={tree}
            value={query}
            onChange={setQuery}
            onOpen={(path) => void controller.openFile(path)}
            label="Search files"
            className="w-full"
            listClassName="max-h-56 overflow-auto px-2 pb-2"
          />
        ) : (
          <button
            type="button"
            onClick={() => void openFolder()}
            className="rounded-xl border border-dashed border-line px-6 py-4 text-sm text-muted transition-colors hover:border-accent hover:text-text"
          >
            Open folder
          </button>
        )}

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

        {status.state === 'loading' && (
          <p className="text-xs text-muted">Starting local storage…</p>
        )}
        {status.state === 'error' && (
          <p role="alert" className="text-xs text-diff-remove-fg">
            Storage unavailable: {status.message}
          </p>
        )}
      </div>
    </section>
  )
}
