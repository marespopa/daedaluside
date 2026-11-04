import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect } from 'react'
import { MOD_KEY_LABEL } from '../lib/platform'
import { openExPrompt } from '../editor/vimMode'
import {
  editorHandleAtom,
  paletteOpenAtom,
  paletteQueryAtom,
  vimEnabledAtom,
} from '../state/editorAtoms'
import {
  currentWorkspaceIdAtom,
  noticeAtom,
  settingsOpenAtom,
  workspacesAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { Icon } from '../ui'
import { useFolderPicker } from './useFolderPicker'
import { useFilePicker } from './useFilePicker'
import { useController } from './useWorkspace'

const KEYMAP: { keys: string; label: string }[] = [
  { keys: `${MOD_KEY_LABEL}+K`, label: 'Command Palette' },
  { keys: `${MOD_KEY_LABEL}+P`, label: 'Search Files' },
  { keys: `${MOD_KEY_LABEL}+N`, label: 'New Scratch Buffer' },
  { keys: `${MOD_KEY_LABEL}+O`, label: 'Switch Workspace' },
]

/** Quiet dashed-border styling shared by the opener's actions. */
const ACTION_CLASS =
  'rounded-xl border border-dashed border-line px-6 py-4 text-sm text-muted transition-colors hover:border-accent hover:text-text'

/**
 * The blank page, shown when no file is open. A single quiet column on the canvas: no
 * cards, no borders. Typing starts an untitled file, so the page works like paper.
 * Searching uses the command palette, not a finder of its own.
 */
export default function WorkspaceOpener() {
  const controller = useController()
  const { pick: pickFolder } = useFolderPicker()
  const { pick: pickFile } = useFilePicker()
  const store = useStore()
  const status = useAtomValue(workspaceStatusAtom)
  const workspaces = useAtomValue(workspacesAtom)
  const currentId = useAtomValue(currentWorkspaceIdAtom)
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

  const openWith = async (pick: () => Promise<void>) => {
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

  const openFolder = () => openWith(pickFolder)
  const openFile = () => openWith(pickFile)

  /** Opens the command palette in file mode, as Mod-P does, from a click. */
  const searchFiles = () => {
    store.set(paletteQueryAtom, '')
    store.set(paletteOpenAtom, true)
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
          <label className="flex h-9 w-full items-center gap-2 rounded-md bg-surface px-3 text-muted focus-within:text-text focus-within:ring-1 focus-within:ring-accent/50">
            <Icon name="search" className="size-3.5 shrink-0" />
            <input
              type="text"
              readOnly
              aria-label="Search files"
              aria-haspopup="dialog"
              placeholder="Search files"
              spellCheck={false}
              autoComplete="off"
              onClick={searchFiles}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  searchFiles()
                }
              }}
              className="min-w-0 flex-1 cursor-pointer bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </label>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void openFolder()}
              className={ACTION_CLASS}
            >
              Open folder
            </button>
            <button
              type="button"
              onClick={() => void openFile()}
              className={ACTION_CLASS}
            >
              Open file
            </button>
          </div>
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
