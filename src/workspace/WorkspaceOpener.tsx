import { useAtomValue, useSetAtom } from 'jotai'
import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from 'react'
import { MOD_KEY_LABEL } from '../lib/platform'
import {
  currentWorkspaceIdAtom,
  noticeAtom,
  sidebarOpenAtom,
  treeAtom,
  workspacesAtom,
  workspaceStatusAtom,
  type WorkspaceStatus,
} from '../state/workspaceAtoms'
import { Button, Icon, IconButton, Kbd, type IconName } from '../ui'
import { useFolderPicker } from './useFolderPicker'
import { useController } from './useWorkspace'

const RECENT_LIMIT = 5
const MAX_NAME_LENGTH = 100

const GRID: CSSProperties = {
  backgroundImage:
    'linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)',
  backgroundSize: '24px 24px',
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

function timeAgo(then: number, now: number): string {
  const seconds = Math.round((then - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(Math.round(seconds), 'second')
}

function storageLabel(status: WorkspaceStatus): string {
  switch (status.state) {
    case 'loading':
      return 'Starting local storage'
    case 'ready':
      return status.backend === 'opfs'
        ? 'OPFS · on this device'
        : 'IndexedDB · on this device'
    case 'error':
      return 'Storage unavailable'
  }
}

function storageDot(status: WorkspaceStatus): string {
  switch (status.state) {
    case 'loading':
      return 'bg-muted'
    case 'ready':
      return 'bg-diff-add-fg'
    case 'error':
      return 'bg-diff-remove-fg'
  }
}

/**
 * Empty state shown in the editor container when no buffer is open. Covers the
 * editor's read-only host; the CodeMirror view stays mounted underneath.
 */
export default function WorkspaceOpener() {
  const controller = useController()
  const status = useAtomValue(workspaceStatusAtom)
  const workspaces = useAtomValue(workspacesAtom)
  const currentId = useAtomValue(currentWorkspaceIdAtom)
  const tree = useAtomValue(treeAtom)
  const setNotice = useSetAtom(noticeAtom)
  const setSidebar = useSetAtom(sidebarOpenAtom)
  const { pick, input } = useFolderPicker()

  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [now] = useState(() => Date.now())
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const ready = status.state === 'ready'
  // With a workspace open, the page describes it. Only a workspace-less state gets the
  // generic "Open a workspace" copy.
  const current = workspaces.find((w) => w.id === currentId)
  const fileCount = tree.filter((e) => e.kind === 'file').length
  const recents = [...workspaces]
    .sort((a, b) => b.updated - a.updated)
    .slice(0, RECENT_LIMIT)

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

  const cancelNaming = () => {
    setNaming(false)
    setName('')
  }

  const createWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = name.trim()
    if (!value) return
    void controller.createWorkspace(value)
    cancelNaming()
  }

  return (
    <section
      aria-label="Workspace opener"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`absolute inset-0 overflow-y-auto bg-canvas text-text font-sans transition-colors duration-200 ${
        dragging ? 'bg-accent/5 ring-2 ring-accent ring-inset' : ''
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={GRID}
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-[560px] flex-col justify-center gap-8 px-6 py-12">
        <header className="space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-muted">
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${storageDot(status)}`}
            />
            {storageLabel(status)}
          </span>
          <h2 className="text-2xl font-normal tracking-tight">
            {current ? current.name : 'Open a workspace'}
          </h2>
          {current ? (
            <p className="text-sm leading-relaxed text-muted">
              {fileCount === 1 ? '1 file' : `${fileCount} files`} in this workspace, none
              open. Pick one from the file tree, or switch workspaces below.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              Choose a folder to edit, or drop a <code className="font-mono">.zip</code>{' '}
              to unpack one. Files stay on this device and work offline.
            </p>
          )}
          {current && (
            <Button
              variant="secondary"
              size="sm"
              icon="menu"
              onClick={() => setSidebar(true)}
            >
              Show file tree
            </Button>
          )}
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ActionCard
            icon="folder"
            title="Open local folder"
            detail="Import a folder from your device"
            disabled={!ready}
            onClick={() => void pick()}
          />
          {naming ? (
            <form
              onSubmit={createWorkspace}
              className="flex flex-col gap-3 rounded-xl border border-accent bg-surface p-4"
            >
              <label htmlFor="opener-workspace-name" className="text-sm font-medium">
                Workspace name
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="opener-workspace-name"
                  autoFocus
                  maxLength={MAX_NAME_LENGTH}
                  value={name}
                  spellCheck={false}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') cancelNaming()
                  }}
                  placeholder="my-project"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
                  Create
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelNaming}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <ActionCard
              icon="plus"
              title="New workspace"
              detail="Start an empty, sandboxed workspace"
              disabled={!ready}
              onClick={() => setNaming(true)}
            />
          )}
        </div>

        {recents.length > 0 && (
          <section aria-labelledby="opener-recents" className="space-y-2">
            <div className="flex items-center justify-between px-1 font-mono text-[11px] tracking-wider text-muted uppercase">
              <h3 id="opener-recents" className="font-normal">
                Recent workspaces
              </h3>
              <span>Updated</span>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {recents.map((ws) => (
                <li key={ws.id} className="flex items-center">
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => void controller.switchTo(ws.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                  >
                    <Icon name="drive" className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {ws.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {ws.id === currentId ? 'Current' : timeAgo(ws.updated, now)}
                    </span>
                  </button>
                  {pendingDelete === ws.id ? (
                    <span className="flex shrink-0 items-center gap-1 pr-2">
                      <Button
                        variant="danger"
                        size="sm"
                        autoFocus
                        onClick={() => {
                          setPendingDelete(null)
                          void controller.deleteWorkspace(ws.id)
                        }}
                      >
                        Delete
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(null)}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <span className="shrink-0 pr-2">
                      <IconButton
                        size="sm"
                        icon="trash"
                        label={`Delete workspace ${ws.name}, ${timeAgo(ws.updated, now)}`}
                        onClick={() => setPendingDelete(ws.id)}
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-xs text-muted">
          <Icon name="upload" className="size-4 shrink-0" />
          <span>
            Drop a <code className="font-mono text-text">.zip</code> anywhere on this page
            to unpack it as a workspace.
          </span>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <Kbd>{MOD_KEY_LABEL}</Kbd>
            <Kbd>K</Kbd>
            command palette
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>{MOD_KEY_LABEL}</Kbd>
            <Kbd>B</Kbd>
            file tree
          </span>
        </footer>
      </div>

      {input}
    </section>
  )
}

function ActionCard({
  icon,
  title,
  detail,
  disabled,
  onClick,
}: {
  icon: IconName
  title: string
  detail: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col gap-6 rounded-xl border border-line bg-surface p-4 text-left transition duration-150 hover:border-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
    >
      <span className="flex size-8 items-center justify-center rounded-lg border border-line text-text">
        <Icon name={icon} className="size-4" />
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{detail}</span>
      </span>
    </button>
  )
}
