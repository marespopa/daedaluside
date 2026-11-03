import { openSearchPanel } from '@codemirror/search'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { themeAtom } from '../lib/theme'
import { THEMES, type ThemePreference } from '../lib/themes'
import {
  activeBufferAtom,
  editorHandleAtom,
  paletteOpenAtom,
  paletteQueryAtom,
} from '../state/editorAtoms'
import {
  activePathAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
  treeAtom,
} from '../state/workspaceAtoms'
import { GlassPopover } from '../ui'
import { useController } from '../workspace/useWorkspace'
import type { Entry } from '../workspace/types'
import { languageList } from './languages'
import {
  COMMAND_PREFIX,
  matchCommands,
  matchFiles,
  paletteMode,
  paletteNeedle,
  type PaletteItem,
} from './paletteSearch'

/**
 * Plain input searches files. A leading `>` searches commands, as in VS Code.
 * Mod-P and Mod-K open the palette in file mode, Mod-Shift-P opens it in command mode.
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
  const tree = useAtomValue(treeAtom)
  const activePath = useAtomValue(activePathAtom)

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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

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
      { id: 'tree', label: 'View: Toggle File Tree', run: () => setSidebar((o) => !o) },
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
  }, [handle, setTheme, setBuffer, controller, activePath, setSettings, setSidebar])

  const files = useMemo(() => tree.filter((e) => e.kind === 'file'), [tree])

  if (!open) return null
  return (
    <PaletteDialog
      commands={commands}
      files={files}
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
  query,
  onQuery,
  onOpenFile,
  onClose,
  onRestoreFocus,
}: {
  commands: PaletteItem[]
  files: readonly Entry[]
  query: string
  onQuery: (q: string) => void
  onOpenFile: (path: string) => void
  onClose: () => void
  onRestoreFocus: () => void
}) {
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const commandMode = paletteMode(query) === 'commands'
  const needle = paletteNeedle(query)

  const results = useMemo<PaletteItem[]>(
    () =>
      commandMode
        ? matchCommands(commands, needle)
        : matchFiles(files, needle).map((e) => ({
            id: `file:${e.path}`,
            label: e.path,
            run: () => onOpenFile(e.path),
          })),
    [commandMode, commands, files, needle, onOpenFile],
  )
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
    onClose()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex(Math.min(sel + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(Math.max(sel - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[sel])
    }
  }

  const emptyText = commandMode
    ? 'No matching commands'
    : files.length === 0
      ? 'No files in this workspace'
      : 'No matching files'

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
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={sel >= 0 ? `palette-option-${sel}` : undefined}
          value={query}
          onChange={(e) => {
            onQuery(e.target.value)
            setIndex(0)
          }}
          placeholder={
            commandMode ? 'Search commands' : 'Search files. Type > for commands'
          }
          className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
        />
        <ul
          ref={list}
          id="palette-list"
          role="listbox"
          className="max-h-72 overflow-auto border-t border-line"
        >
          {results.length === 0 && (
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
