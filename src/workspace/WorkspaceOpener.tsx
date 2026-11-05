import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useState } from 'react'
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
  treeAtom,
  treeCompleteAtom,
  treeProgressAtom,
  treeStatusAtom,
  workspacesAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import { gitBranchAtom } from '../state/gitAtoms'
import { useFolderPicker } from './useFolderPicker'
import { useFilePicker } from './useFilePicker'
import { useController } from './useWorkspace'

const ENTRY_POINTS = [
  /^package\.json$/,
  /^src\/(index|main)\.[jt]sx?$/,
  /^src\/App\.[jt]sx$/,
]

const LOADING_WORDS = [
  'Gathering',
  'Wandering',
  'Unfolding',
  'Tracing',
  'Weaving',
  'Sifting',
  'Mapping',
  'Threading',
  'Listening',
  'Kindling',
]

/** A shuffled word that changes every 1.4s while `active`; the order is random per mount. */
function useRotatingWord(active: boolean) {
  const [order] = useState(() => [...LOADING_WORDS].sort(() => Math.random() - 0.5))
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setI((n) => (n + 1) % order.length), 1400)
    return () => clearInterval(id)
  }, [active, order])
  return order[i]
}

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
  const treeComplete = useAtomValue(treeCompleteAtom)
  const branch = useAtomValue(gitBranchAtom)
  const tree = useAtomValue(treeAtom)
  const fileCount = tree.filter((e) => e.kind === 'file').length

  const ready = status.state === 'ready'
  const current = workspaces.find((w) => w.id === currentId)
  const hasWorkspace = currentId != null
  // Folder actions wait for the tree to finish loading; switching workspaces never needs it.
  const folderReady = ready && hasWorkspace && treeStatus.state === 'ready'
  // "Ready" waits for the whole tree: file search needs every name.
  const loadingTree =
    hasWorkspace && (treeStatus.state === 'loading' || (folderReady && !treeComplete))
  // Folder actions stay disabled until the whole workspace is loaded.
  const workspaceReady = folderReady && treeComplete
  useEffect(() => {
    if (folderReady) void controller.ensureFullTree()
  }, [folderReady, controller])
  const loadingWord = useRotatingWord(loadingTree)
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

  // Root files worth a direct link; shown only when present.
  const entryPoints = workspaceReady
    ? ENTRY_POINTS.map((re) => tree.find((e) => e.kind === 'file' && re.test(e.path)))
        .filter((e): e is NonNullable<typeof e> => !!e)
        .slice(0, 3)
    : []

  const quietBtn =
    'rounded px-2 py-1 text-xs text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50'

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
            <div role="alert" className="space-y-2 text-xs text-diff-remove-fg">
              <p>Access to this folder expired.</p>
              <button
                type="button"
                onClick={() => void controller.reconnectFolder()}
                className="rounded border border-muted/40 px-3 py-1 text-text hover:bg-line/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Re-grant folder access
              </button>
            </div>
          ) : (
            <p
              className="text-xs text-muted"
              role={loadingTree || folderReady ? 'status' : undefined}
            >
              {loadingTree
                ? `${loadingWord}…${progress ? ` ${progress.done}${progress.total ? ` / ${progress.total}` : ''} files` : ''}`
                : folderReady
                  ? `${branch ? `${branch} · ` : ''}${fileCount} ${fileCount === 1 ? 'file' : 'files'}`
                  : 'Open a folder to start editing.'}
            </p>
          )}
        </header>

        {loadingTree && (
          <div aria-hidden className="h-0.5 w-full overflow-hidden rounded bg-line">
            {progress?.total ? (
              <div
                className="h-full bg-accent transition-[width] duration-150 motion-reduce:transition-none"
                style={{
                  width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`,
                }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse bg-accent motion-reduce:animate-none" />
            )}
          </div>
        )}

        {hasWorkspace ? (
          workspaceReady && (
            <>
              <button
                type="button"
                onClick={searchFiles}
                className="flex h-10 w-full items-center justify-between rounded-lg border border-muted/40 px-3 text-sm text-muted transition-colors hover:border-muted/60 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50"
              >
                <span>Search Files</span>
                <kbd className="font-mono text-[11px]">{MOD_KEY_LABEL}+P</kbd>
              </button>
              {entryPoints.length > 0 && (
                <nav
                  aria-label="Entry points"
                  className="flex flex-wrap justify-center gap-1"
                >
                  {entryPoints.map((e) => (
                    <button
                      key={e.path}
                      type="button"
                      onClick={() => void controller.openFile(e.path)}
                      className={quietBtn}
                    >
                      {e.path}
                    </button>
                  ))}
                </nav>
              )}
              <p className="text-xs text-muted">
                <kbd className="font-mono">{MOD_KEY_LABEL}+K</kbd> commands ·{' '}
                <kbd className="font-mono">{MOD_KEY_LABEL}+Shift+F</kbd> find in files
              </p>
            </>
          )
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!ready}
              onClick={() => void openFolder()}
              className={quietBtn}
            >
              Open folder
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={() => void openFile()}
              className={quietBtn}
            >
              Open file
            </button>
          </div>
        )}

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
