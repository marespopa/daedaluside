import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { lazy, Suspense, useEffect } from 'react'
import CommandPalette from './editor/CommandPalette'
import GrepFinder from './editor/GrepFinder'
import DiffStat from './editor/DiffStat'
import Editor from './editor/Editor'
import VimStatus from './editor/VimStatus'
import { activeBufferAtom, editorWidthAtom } from './state/editorAtoms'
import { aiOpenAtom } from './state/aiAtoms'
import { activePathAtom, settingsOpenAtom, sidebarOpenAtom } from './state/workspaceAtoms'
import { IconButton } from './ui'
import FileTree from './workspace/FileTree'
import HomeButton from './workspace/HomeButton'
import BranchStatus from './workspace/BranchStatus'
import Notice from './workspace/Notice'
import ReconnectDialog from './workspace/ReconnectDialog'
import SaveButton from './workspace/SaveButton'
import Tabs from './workspace/Tabs'
import { useController, useWorkspaceLifecycle } from './workspace/useWorkspace'

const SettingsDialog = lazy(() => import('./workspace/SettingsDialog'))
const AiPanel = lazy(() => import('./ai/AiPanel'))

export default function App() {
  useWorkspaceLifecycle()
  const controller = useController()
  const activePath = useAtomValue(activePathAtom)
  const buffer = useAtomValue(activeBufferAtom)
  const [width, setWidth] = useAtom(editorWidthAtom)
  const setSidebarOpen = useSetAtom(sidebarOpenAtom)
  const settingsOpen = useAtomValue(settingsOpenAtom)
  const aiOpen = useAtomValue(aiOpenAtom)

  useEffect(() => {
    let wasNarrow = window.innerWidth < 1024
    if (wasNarrow) setSidebarOpen(false)
    const collapseOnNarrowViewport = () => {
      const narrow = window.innerWidth < 1024
      // Only react when the breakpoint is crossed: the picker and soft keyboard fire
      // resize events that must not re-close a sidebar the user just opened.
      if (narrow && !wasNarrow) setSidebarOpen(false)
      wasNarrow = narrow
    }
    window.addEventListener('resize', collapseOnNarrowViewport)
    return () => window.removeEventListener('resize', collapseOnNarrowViewport)
  }, [setSidebarOpen])

  return (
    <div className="flex h-full bg-canvas text-text">
      <FileTree />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-header min-w-0 shrink-0 items-center gap-1 px-3 font-sans text-sm text-muted">
          <IconButton
            label="Toggle file tree"
            icon="sidebar"
            onClick={(e) => {
              e.stopPropagation()
              setSidebarOpen((open) => !open)
            }}
          />
          <HomeButton />
          <Tabs />
          <span className="sr-only">
            {buffer.name
              ? `Editing ${buffer.name}${buffer.dirty ? ', unsaved' : ''}`
              : ''}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {activePath && (
              <IconButton
                label="Copy contents"
                icon="copy"
                onClick={() => void controller.copyActiveText()}
              />
            )}
            <SaveButton />
            {activePath && (
              <IconButton
                label="Full width"
                icon="width"
                aria-pressed={width === 'full'}
                className="aria-pressed:bg-surface aria-pressed:text-text"
                onClick={() => setWidth(width === 'full' ? 'measured' : 'full')}
              />
            )}
          </div>
        </header>
        <main
          id="editor-pane"
          className="min-h-0 flex-1"
        >
          <h1 className="sr-only">Daedalus IDE</h1>
          <Editor />
        </main>
        <div className="flex shrink-0 items-baseline">
          <VimStatus />
          <div className="ml-auto flex items-baseline gap-3 px-3 pb-1">
            {activePath !== null && <BranchStatus />}
            <DiffStat />
          </div>
        </div>
      </div>
      <CommandPalette />
      <GrepFinder />
      <Suspense fallback={null}>{settingsOpen && <SettingsDialog />}</Suspense>
      <Suspense fallback={null}>{aiOpen && <AiPanel />}</Suspense>
      <ReconnectDialog />
      <Notice />
    </div>
  )
}
