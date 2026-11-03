import { useAtomValue } from 'jotai'
import { useState } from 'react'
import CommandPalette from './editor/CommandPalette'
import Editor from './editor/Editor'
import { activeBufferAtom } from './state/editorAtoms'
import { IconButton, Kbd } from './ui'

export default function App() {
  const [sidebar, setSidebar] = useState(false)
  const buffer = useAtomValue(activeBufferAtom)
  return (
    <div className="flex h-full bg-canvas text-text">
      {sidebar && (
        <aside
          aria-label="Sidebar"
          className="glass w-64 shrink-0 border-r border-line p-4 font-sans text-sm text-muted"
        >
          Files appear here once workspaces land.
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="group flex h-12 shrink-0 items-center gap-2 border-b border-transparent px-3 font-sans text-sm text-muted transition-colors hover:border-line focus-within:border-line">
          <IconButton
            label={sidebar ? 'Hide sidebar' : 'Show sidebar'}
            aria-expanded={sidebar}
            onClick={() => setSidebar((s) => !s)}
          >
            ☰
          </IconButton>
          <nav aria-label="Breadcrumb" className="font-mono text-xs">
            {buffer.name}
            {buffer.dirty && <span aria-label="unsaved"> •</span>}
          </nav>
          <span className="ml-auto text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
          </span>
        </header>
        <main className="min-h-0 flex-1">
          <h1 className="sr-only">Daedalus IDE</h1>
          <Editor />
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}
