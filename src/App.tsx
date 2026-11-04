import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import CommandPalette from './editor/CommandPalette'
import Editor from './editor/Editor'
import VimStatus from './editor/VimStatus'
import { activeBufferAtom, editorWidthAtom } from './state/editorAtoms'
import { sidebarOpenAtom } from './state/workspaceAtoms'
import { IconButton } from './ui'
import FileTree from './workspace/FileTree'
import HomeButton from './workspace/HomeButton'
import Notice from './workspace/Notice'
import OpenFolderButton from './workspace/OpenFolderButton'
import ReconnectDialog from './workspace/ReconnectDialog'
import SaveButton from './workspace/SaveButton'
import SettingsDialog from './workspace/SettingsDialog'
import Tabs from './workspace/Tabs'
import { useWorkspaceLifecycle } from './workspace/useWorkspace'

export default function App() {
  useWorkspaceLifecycle()
  const buffer = useAtomValue(activeBufferAtom)
  const [width, setWidth] = useAtom(editorWidthAtom)
  const setSidebarOpen = useSetAtom(sidebarOpenAtom)
  useEffect(() => {
    const collapseOnNarrowViewport = () => {
      if (window.innerWidth < 1024) setSidebarOpen(false)
    }
    collapseOnNarrowViewport()
    window.addEventListener('resize', collapseOnNarrowViewport)
    return () => window.removeEventListener('resize', collapseOnNarrowViewport)
  }, [setSidebarOpen])
  return (
    <div className="flex h-full bg-canvas text-text">
      <FileTree />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-header min-w-0 shrink-0 items-center gap-1 px-3 font-sans text-sm text-muted">
          <HomeButton />
          <Tabs />
          <span className="sr-only">
            {buffer.name
              ? `Editing ${buffer.name}${buffer.dirty ? ', unsaved' : ''}`
              : ''}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <SaveButton />
            <IconButton
              label="Full width"
              icon="width"
              aria-pressed={width === 'full'}
              className="aria-pressed:bg-surface aria-pressed:text-text"
              onClick={() => setWidth(width === 'full' ? 'measured' : 'full')}
            />
            <OpenFolderButton />
          </div>
        </header>
        <main
          id="editor-pane"
          onPointerDownCapture={() => setSidebarOpen(false)}
          className="min-h-0 flex-1"
        >
          <h1 className="sr-only">Daedalus IDE</h1>
          <Editor />
        </main>
        <VimStatus />
      </div>
      <CommandPalette />
      <SettingsDialog />
      <ReconnectDialog />
      <Notice />
    </div>
  )
}
