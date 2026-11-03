import { useAtom, useAtomValue } from 'jotai'
import CommandPalette from './editor/CommandPalette'
import Editor from './editor/Editor'
import { activeBufferAtom, editorWidthAtom } from './state/editorAtoms'
import { importStatusAtom, sidebarOpenAtom } from './state/workspaceAtoms'
import { IconButton } from './ui'
import FileTree from './workspace/FileTree'
import Notice from './workspace/Notice'
import OpenFolderButton from './workspace/OpenFolderButton'
import SettingsDialog from './workspace/SettingsDialog'
import Tabs from './workspace/Tabs'
import { useWorkspaceLifecycle } from './workspace/useWorkspace'

export default function App() {
  useWorkspaceLifecycle()
  const [sidebar, setSidebar] = useAtom(sidebarOpenAtom)
  const buffer = useAtomValue(activeBufferAtom)
  const importing = useAtomValue(importStatusAtom)
  const [width, setWidth] = useAtom(editorWidthAtom)
  return (
    <div className="flex h-full bg-canvas text-text">
      <FileTree />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-header min-w-0 shrink-0 items-center gap-1 px-3 font-sans text-sm text-muted">
          <IconButton
            label={sidebar ? 'Hide file tree' : 'Show file tree'}
            icon="menu"
            aria-expanded={sidebar}
            onClick={() => setSidebar((s) => !s)}
          />
          {/* Hidden while a folder opens: the old scratch tab must not outlive the blank page. */}
          {importing === null && <Tabs />}
          <span className="sr-only">
            {buffer.name
              ? `Editing ${buffer.name}${buffer.dirty ? ', unsaved' : ''}`
              : ''}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
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
        <main id="editor-pane" className="min-h-0 flex-1">
          <h1 className="sr-only">Daedalus IDE</h1>
          <Editor />
        </main>
      </div>
      <CommandPalette />
      <SettingsDialog />
      <Notice />
    </div>
  )
}
