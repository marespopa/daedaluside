import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect } from 'react'
import { MOD_KEY_LABEL } from '../lib/platform'
import { COMMAND_PREFIX } from '../editor/paletteSearch'
import { openExPrompt } from '../editor/vimMode'
import {
  editorHandleAtom,
  grepOpenAtom,
  paletteOpenAtom,
  paletteQueryAtom,
  vimEnabledAtom,
} from '../state/editorAtoms'
import {
  currentWorkspaceIdAtom,
  noticeAtom,
  settingsOpenAtom,
  treeAtom,
  treeProgressAtom,
  treeStatusAtom,
  workspacesAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { useFolderPicker } from './useFolderPicker'
import { useFilePicker } from './useFilePicker'
import { useLoadEta } from './loadEstimate'
import { useController } from './useWorkspace'

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
  const treeStatus = useAtomValue(treeStatusAtom)
  const progress = useAtomValue(treeProgressAtom)
  const fileCount = useAtomValue(treeAtom).filter((e) => e.kind === 'file').length
  const { eta, elapsed } = useLoadEta(progress)

  const ready = status.state === 'ready'
  const current = workspaces.find((w) => w.id === currentId)
  const hasWorkspace = currentId != null
  // Folder actions wait for the tree to finish loading; switching workspaces never needs it.
  const folderReady = ready && hasWorkspace && treeStatus.state === 'ready'
  const loadingTree = hasWorkspace && treeStatus.state === 'loading'
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

  const showPalette = (q: string) => () => {
    store.set(paletteQueryAtom, q)
    store.set(paletteOpenAtom, true)
  }

  const paletteAction = { keys: `${MOD_KEY_LABEL}+K`, label: 'Command Palette', enabled: ready, run: showPalette('') }
  const switchAction = {
    keys: `${MOD_KEY_LABEL}+O`,
    label: 'Switch Workspace',
    enabled: ready,
    run: showPalette(`${COMMAND_PREFIX}Workspace: `),
  }
  const actions: { keys?: string; label: string; enabled: boolean; run: () => void }[] = hasWorkspace
    ? [
        { keys: `${MOD_KEY_LABEL}+P`, label: 'Search Files', enabled: folderReady, run: searchFiles },
        { keys: `${MOD_KEY_LABEL}+Shift+F`, label: 'Find in Files', enabled: folderReady, run: () => store.set(grepOpenAtom, true) },
        { keys: `${MOD_KEY_LABEL}+N`, label: 'New Scratch Buffer', enabled: folderReady, run: () => void controller.startUntitled('') },
        { keys: `${MOD_KEY_LABEL}+Shift+B`, label: 'Branch Review', enabled: folderReady, run: () => void controller.openBranchReview() },
        paletteAction,
        switchAction,
      ]
    : [
        { label: 'Open folder', enabled: ready, run: () => void openFolder() },
        { label: 'Open file', enabled: ready, run: () => void openFile() },
        paletteAction,
        switchAction,
      ]

  return (
    <section
      aria-label="Workspace opener"
      className="absolute inset-x-0 top-0 bottom-10 flex items-center justify-center overflow-y-auto bg-canvas px-6 font-sans text-text"
    >
      <div className="flex w-full max-w-[420px] flex-col items-center gap-8 py-12 text-center">
        <header className="space-y-2">
          <h2 className="text-sm font-medium text-text">{title}</h2>
          {treeStatus.state === 'error' && hasWorkspace ? (
            <p role="alert" className="text-xs text-diff-remove-fg">
              Could not read this folder: {treeStatus.message}
            </p>
          ) : treeStatus.state === 'permission' && hasWorkspace ? (
            <p role="alert" className="text-xs text-diff-remove-fg">
              Access to this folder expired. Reconnect it from the sidebar.
            </p>
          ) : (
            <p className="text-xs text-muted" role={loadingTree || folderReady ? 'status' : undefined}>
              {loadingTree
                ? `Loading workspace…${progress ? ` ${progress.done}${progress.total ? ` / ${progress.total}` : ''} files` : ''}${eta ? ` · ${eta}` : elapsed ? ` · ${elapsed}` : ''}`
                : folderReady
                  ? `Workspace ready · ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`
                  : 'Open a folder to start editing.'}
            </p>
          )}
        </header>

        {loadingTree && (
          <div aria-hidden className="h-0.5 w-full overflow-hidden rounded bg-line">
            {progress?.total ? (
              <div
                className="h-full bg-accent transition-[width] duration-150 motion-reduce:transition-none"
                style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse bg-accent motion-reduce:animate-none" />
            )}
          </div>
        )}

        <ul className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
          {actions.map((a) => (
            <li key={a.label}>
              <button
                type="button"
                disabled={!a.enabled}
                onClick={a.run}
                className="flex h-16 w-full flex-col items-center justify-center gap-1 rounded-lg border border-line px-2 text-xs text-text transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
              >
                <span>{a.label}</span>
                {a.keys && <kbd className="font-mono text-[11px] text-muted">{a.keys}</kbd>}
              </button>
            </li>
          ))}
        </ul>

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
