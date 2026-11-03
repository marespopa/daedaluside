import { openSearchPanel } from '@codemirror/search'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDoubleShift } from '../lib/doubleShift'
import { themeAtom } from '../lib/theme'
import { THEMES, type ThemePreference } from '../lib/themes'
import {
  activeBufferAtom,
  editorHandleAtom,
  editorWidthAtom,
  paletteOpenAtom,
  paletteQueryAtom,
  vimEnabledAtom,
} from '../state/editorAtoms'
import {
  activePathAtom,
  currentWorkspaceIdAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
  treeAtom,
  workspacesAtom,
} from '../state/workspaceAtoms'
import { GlassPopover, Input } from '../ui'
import { joinPath } from '../workspace/path'
import { useController } from '../workspace/useWorkspace'
import type { Entry } from '../workspace/types'
import { languageList } from './languages'
import {
  COMMAND_PREFIX,
  matchCommands,
  matchFiles,
  type NewEntryRequest,
  paletteMode,
  paletteNeedle,
  type PaletteItem,
} from './paletteSearch'

/**
 * Plain input searches files. A leading `>` searches commands, as in VS Code.
 * Mod-P and Mod-K open the palette in file mode. Mod-Shift-P and a double tap of Shift
 * open it in command mode.
 */
export default function CommandPalette() {
  const store = useStore()
  const [open, setOpen] = useAtom(paletteOpenAtom)
  const [query, setQuery] = useAtom(paletteQueryAtom)
  const handle = useAtomValue(editorHandleAtom)
  const setTheme = useSetAtom(themeAtom)
  const setBuffer = useSetAtom(activeBufferAtom)
  const controller = useController()
  const setSettings = useSetAtom(settingsOpenAtom)
  const setSidebar = useSetAtom(sidebarOpenAtom)
  const setWidth = useSetAtom(editorWidthAtom)
  const tree = useAtomValue(treeAtom)
  const activePath = useAtomValue(activePathAtom)
  const workspaces = useAtomValue(workspacesAtom)
  const currentId = useAtomValue(currentWorkspaceIdAtom)
  const folders = useMemo(() => tree.filter((e) => e.kind === 'dir'), [tree])
  const createEntry = useCallback(
    (kind: NewEntryRequest['kind'], path: string) =>
      void (kind === 'file'
        ? controller.createFile(path)
        : controller.createFolder(path)),
    [controller],
  )

  useEffect(() => {
    const show = (q: string) => {
      store.set(paletteQueryAtom, q)
      store.set(paletteOpenAtom, true)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'p' && e.shiftKey) {
        e.preventDefault()
        show(COMMAND_PREFIX)
      } else if (key === 'p' || key === 'k') {
        e.preventDefault()
        if (store.get(paletteOpenAtom)) store.set(paletteOpenAtom, false)
        else show('')
      } else if (key === 'n' && !e.shiftKey) {
        e.preventDefault()
        void controller.startUntitled('')
      } else if (key === 'o' && !e.shiftKey) {
        e.preventDefault()
        show(`${COMMAND_PREFIX}Workspace: `)
      }
    }
    // Double Shift also opens the command palette (IntelliJ-style). Ignored while it is open.
    const doubleShift = createDoubleShift(() => {
      if (!store.get(paletteOpenAtom)) show(COMMAND_PREFIX)
    })
    const onDown = (e: KeyboardEvent) => {
      doubleShift.keydown(e)
      onKey(e)
    }
    const onUp = (e: KeyboardEvent) => doubleShift.keyup(e)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [store, controller])

  const openFile = useCallback(
    (path: string) => void controller.openFile(path),
    [controller],
  )

  const commands = useMemo<PaletteItem[]>(() => {
    const theme = (pref: ThemePreference, label: string): PaletteItem => ({
      id: `theme-${pref}`,
      label: `Theme: ${label}`,
      run: () => setTheme(pref),
    })
    const langs: PaletteItem[] = languageList.map((l) => ({
      id: `lang-${l.name}`,
      label: `Language: ${l.name}`,
      run: () =>
        void handle
          ?.setLanguage(l.name)
          .then((language) => setBuffer((b) => ({ ...b, language }))),
    }))
    return [
      { id: 'save', label: 'File: Save', run: () => void controller.saveActive() },
      {
        id: 'close',
        label: 'File: Close Buffer',
        run: () => activePath && void controller.closeBuffer(activePath),
      },
      { id: 'tree', label: 'View: Open File Tree (:Explore)', run: () => setSidebar(true) },
      {
        id: 'width',
        label: 'View: Toggle Full Width',
        run: () => setWidth(store.get(editorWidthAtom) === 'full' ? 'measured' : 'full'),
      },
      {
        id: 'vim',
        label: 'Editor: Toggle Vim Mode',
        run: () => store.set(vimEnabledAtom, !store.get(vimEnabledAtom)),
      },
      {
        id: 'tab-close-others',
        label: 'Tab: Close Others',
        run: () => activePath && void controller.closeOthers(activePath),
      },
      {
        id: 'tab-close-right',
        label: 'Tab: Close to the Right',
        run: () => activePath && void controller.closeToRight(activePath),
      },
      {
        id: 'tab-close-all',
        label: 'Tab: Close All',
        run: () => void controller.closeAll(),
      },
      {
        id: 'tab-pin',
        label: 'Tab: Pin or Unpin',
        run: () => activePath && controller.togglePin(activePath),
      },
      {
        id: 'tab-move-left',
        label: 'Tab: Move Left',
        run: () => activePath && controller.moveTab(activePath, -1),
      },
      {
        id: 'tab-move-right',
        label: 'Tab: Move Right',
        run: () => activePath && controller.moveTab(activePath, 1),
      },
      {
        id: 'tab-copy-path',
        label: 'Tab: Copy Relative Path',
        run: () => activePath && void controller.copyPath(activePath),
      },
      { id: 'settings', label: 'Settings: Storage', run: () => setSettings(true) },
      { id: 'new-file', label: 'File: New File', enter: { kind: 'file' } },
      { id: 'new-folder', label: 'File: New Folder', enter: { kind: 'folder' } },
      {
        id: 'new-scratch',
        label: 'File: New Scratch Buffer',
        run: () => void controller.startUntitled(''),
      },
      { id: 'ws-new', label: 'Workspace: New', run: () => void controller.newWorkspace() },
      {
        id: 'ws-delete',
        label: 'Workspace: Delete Current',
        run: () => {
          const current = workspaces.find((w) => w.id === currentId)
          if (!current) return
          if (window.confirm(`Delete "${current.name}" and all its files? This cannot be undone.`))
            void controller.deleteWorkspace(current.id)
        },
      },
      ...workspaces
        .filter((w) => w.id !== currentId)
        .map(
          (w): PaletteItem => ({
            id: `ws-open-${w.id}`,
            label: `Workspace: Switch to ${w.name}`,
            run: () => void controller.switchTo(w.id),
          }),
        ),
      // Label carries the kind, so typing "dark" or "light" finds the matching group.
      ...THEMES.map((t) => theme(t.id, `${t.name} (${t.kind})`)),
      theme('system', 'System'),
      {
        id: 'find',
        label: 'Find and Replace',
        run: () => handle && openSearchPanel(handle.view),
      },
      {
        id: 'lang-none',
        label: 'Language: Plain Text',
        run: () =>
          void handle
            ?.setLanguage(null)
            .then(() => setBuffer((b) => ({ ...b, language: null }))),
      },
      ...langs,
    ]
  }, [
    handle,
    setTheme,
    setBuffer,
    controller,
    activePath,
    setSettings,
    setSidebar,
    setWidth,
    store,
    workspaces,
    currentId,
  ])

  const files = useMemo(() => tree.filter((e) => e.kind === 'file'), [tree])

  if (!open) return null
  return (
    <PaletteDialog
      commands={commands}
      files={files}
      folders={folders}
      onCreate={createEntry}
      query={query}
      onQuery={setQuery}
      onOpenFile={openFile}
      onClose={() => setOpen(false)}
      onRestoreFocus={() => handle?.view.focus()}
    />
  )
}

function PaletteDialog({
  commands,
  files,
  folders,
  query,
  onQuery,
  onOpenFile,
  onCreate,
  onClose,
  onRestoreFocus,
}: {
  commands: PaletteItem[]
  files: readonly Entry[]
  folders: readonly Entry[]
  query: string
  onQuery: (q: string) => void
  onOpenFile: (path: string) => void
  onCreate: (kind: NewEntryRequest['kind'], path: string) => void
  onClose: () => void
  onRestoreFocus: () => void
}) {
  const [index, setIndex] = useState(0)
  /**
   * A create flow in progress. Without a `parent` the palette lists folders to choose from;
   * with one, the query is the new name.
   */
  const [creating, setCreating] = useState<NewEntryRequest | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const locating = creating !== null && creating.parent === undefined
  const naming = creating !== null && creating.parent !== undefined
  const commandMode = !creating && paletteMode(query) === 'commands'
  const needle = paletteNeedle(query)
  const kindLabel = creating?.kind === 'folder' ? 'folder' : 'file'

  const pickLocation = useCallback(
    (parent: string) => {
      setCreating((c) => (c ? { kind: c.kind, parent } : c))
      onQuery('')
      setIndex(0)
    },
    [onQuery],
  )

  const results = useMemo<PaletteItem[]>(() => {
    if (naming) return []
    if (locating) {
      const root: PaletteItem[] =
        needle === ''
          ? [{ id: 'at:', label: '/ (workspace root)', run: () => pickLocation('') }]
          : []
      const dirs = matchFiles(folders, needle).map((f) => ({
        id: `at:${f.path}`,
        label: `${f.path}/`,
        run: () => pickLocation(f.path),
      }))
      return [...root, ...dirs]
    }
    return commandMode
      ? matchCommands(commands, needle)
      : matchFiles(files, needle).map((e) => ({
          id: `file:${e.path}`,
          label: e.path,
          run: () => onOpenFile(e.path),
        }))
  }, [
    naming,
    locating,
    commandMode,
    commands,
    files,
    folders,
    needle,
    onOpenFile,
    pickLocation,
  ])
  const sel = results.length === 0 ? -1 : Math.min(index, results.length - 1)

  useEffect(() => {
    input.current?.focus()
    return onRestoreFocus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (el && typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    if (item.enter) {
      setCreating(item.enter)
      onQuery('')
      setIndex(0)
      return
    }
    // Choosing a folder keeps the palette open for the name; other items finish it.
    if (locating) {
      item.run?.()
      return
    }
    onClose()
    item.run?.()
  }

  /** The name step: the query is the new file or folder name, relative to its folder. */
  const submitName = () => {
    const name = query.trim()
    if (!naming || !creating || creating.parent === undefined || name === '') return
    onClose()
    onCreate(creating.kind, joinPath(creating.parent, name))
  }

  const backOut = () => {
    if (creating) {
      setCreating(null)
      onQuery(COMMAND_PREFIX)
      setIndex(0)
    } else onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      backOut()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex(Math.min(sel + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(Math.max(sel - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (naming) submitName()
      else run(results[sel])
    }
  }

  const parentLabel = creating?.parent ? `${creating.parent}/` : 'the workspace root'
  const placeholder = locating
    ? `Choose a folder for the new ${kindLabel}`
    : naming
      ? `Name the new ${kindLabel}, created in ${parentLabel}`
      : commandMode
        ? 'Search commands'
        : 'Search files. Type > for commands'

  const emptyText = naming
    ? null
    : locating
      ? 'No matching folders'
      : commandMode
        ? 'No matching commands'
        : files.length === 0
          ? 'No files in this workspace'
          : 'No matching files'

  const nameHint =
    naming && creating?.parent !== undefined
      ? query.trim()
        ? `Create ${kindLabel} ${joinPath(creating.parent, query.trim())}  (Enter)`
        : 'Type a name. Esc goes back.'
      : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/60 px-4 pt-[15vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <GlassPopover
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg"
        onKeyDown={onKeyDown}
      >
        <Input
          ref={input}
          variant="bare"
          size="lg"
          className="w-full"
          role="combobox"
          aria-label="Command palette search"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={sel >= 0 ? `palette-option-${sel}` : undefined}
          value={query}
          onChange={(e) => {
            onQuery(e.target.value)
            setIndex(0)
          }}
          placeholder={placeholder}
        />
        <ul
          ref={list}
          id="palette-list"
          role="listbox"
          // Clicking an option keeps focus in the input, so typing and Escape still reach the palette.
          onMouseDown={(e) => e.preventDefault()}
          className="max-h-72 overflow-auto border-t border-line"
        >
          {nameHint && <li className="px-4 py-2 text-sm text-muted">{nameHint}</li>}
          {emptyText && results.length === 0 && (
            <li className="px-4 py-2 text-sm text-muted">{emptyText}</li>
          )}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`palette-option-${i}`}
              role="option"
              aria-selected={i === sel}
              className={`cursor-pointer px-4 py-1.5 text-sm ${i === sel ? 'bg-accent text-canvas' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              {c.label}
            </li>
          ))}
        </ul>
      </GlassPopover>
    </div>
  )
}
