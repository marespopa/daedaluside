import { foldAll, unfoldAll } from '@codemirror/language'
import type { createStore } from 'jotai'
import { themeAtom } from '../lib/theme'
import { THEMES } from '../lib/themes'
import type { ThemeId } from '../lib/themes'
import { sidecarOpenAtom } from '../state/companionAtoms'
import { editorHandleAtom, editorWidthAtom, vimEnabledAtom } from '../state/editorAtoms'
import { fileDiffEnabledAtom } from '../state/gitAtoms'
import {
  activePathAtom,
  settingsOpenAtom,
  sidebarOpenAtom,
} from '../state/workspaceAtoms'
import { getController } from '../workspace/controller'

type Store = ReturnType<typeof createStore>

/**
 * One thing a person can do in the editor, callable by the palette and by the AI companion
 * alike, so neither can do something the other cannot. Keep these free of React.
 */
export interface Action {
  id: string
  description: string
  /** Named string arguments, with what each means. */
  args?: Record<string, string>
  /** Asks the user before running, because it closes work or changes the checked-out branch. */
  confirm?: boolean
  run(store: Store, args: Record<string, string>): void | string | Promise<void | string>
}

export class ActionError extends Error {}

function active(store: Store): string {
  const path = store.get(activePathAtom)
  if (!path) throw new ActionError('No file is open')
  return path
}

function need(args: Record<string, string>, key: string): string {
  const v = args[key]?.trim()
  if (!v) throw new ActionError(`"${key}" is required`)
  return v
}

export const ACTIONS: Action[] = [
  {
    id: 'file.open',
    description: 'Open a file in a tab.',
    args: { path: 'Workspace-relative path.' },
    run: async (s, a) => {
      await getController(s).openFile(need(a, 'path'))
    },
  },
  {
    id: 'file.save',
    description: 'Save the active file.',
    run: async (s) => {
      await getController(s).saveActive()
    },
  },
  {
    id: 'file.close',
    description: 'Close the active tab.',
    run: async (s) => {
      await getController(s).closeBuffer(active(s))
    },
  },
  {
    id: 'tab.close-others',
    description: 'Close every tab except the active one.',
    confirm: true,
    run: async (s) => {
      await getController(s).closeOthers(active(s))
    },
  },
  {
    id: 'tab.close-right',
    description: 'Close the tabs to the right of the active one.',
    run: (s) => getController(s).closeToRight(active(s)),
  },
  {
    id: 'tab.close-all',
    description: 'Close all tabs.',
    confirm: true,
    run: async (s) => {
      await getController(s).closeAll()
    },
  },
  {
    id: 'tab.pin',
    description: 'Pin or unpin the active tab.',
    run: (s) => getController(s).togglePin(active(s)),
  },
  {
    id: 'tab.move-left',
    description: 'Move the active tab one place left.',
    run: (s) => getController(s).moveTab(active(s), -1),
  },
  {
    id: 'tab.move-right',
    description: 'Move the active tab one place right.',
    run: (s) => getController(s).moveTab(active(s), 1),
  },
  {
    id: 'view.sidebar',
    description: 'Open the file tree.',
    run: (s) => s.set(sidebarOpenAtom, true),
  },
  {
    id: 'view.toggle-width',
    description: 'Toggle between the measured and the full editor width.',
    run: (s) =>
      s.set(editorWidthAtom, s.get(editorWidthAtom) === 'full' ? 'measured' : 'full'),
  },
  {
    id: 'view.settings',
    description: 'Open Settings.',
    run: (s) => s.set(settingsOpenAtom, true),
  },
  {
    id: 'editor.toggle-vim',
    description: 'Turn Vim mode on or off.',
    run: (s) => s.set(vimEnabledAtom, !s.get(vimEnabledAtom)),
  },
  {
    id: 'editor.fold-all',
    description: 'Collapse every foldable section in the active file.',
    run: (s) => {
      const view = s.get(editorHandleAtom)?.view
      if (!view) throw new ActionError('No file is open')
      foldAll(view)
    },
  },
  {
    id: 'editor.unfold-all',
    description: 'Expand every collapsed section in the active file.',
    run: (s) => {
      const view = s.get(editorHandleAtom)?.view
      if (!view) throw new ActionError('No file is open')
      unfoldAll(view)
    },
  },
  {
    id: 'editor.toggle-diff',
    description: 'Turn git diff marks in the gutter on or off.',
    run: (s) => getController(s).setFileDiff(!s.get(fileDiffEnabledAtom)),
  },
  {
    id: 'theme.set',
    description: `Switch the theme. "system" follows the OS; otherwise one of: ${THEMES.map((t) => t.id).join(', ')}.`,
    args: { theme: 'Theme id, or "system".' },
    run: (s, a) => {
      const id = need(a, 'theme')
      const current = s.get(themeAtom)
      if (id === 'system') return s.set(themeAtom, { ...current, mode: 'system' })
      const t = THEMES.find((x) => x.id === id)
      if (!t) throw new ActionError(`Unknown theme: ${id}`)
      s.set(themeAtom, { ...current, mode: t.kind, [t.kind]: t.id as ThemeId })
    },
  },
  {
    id: 'ai.toggle-sidecar',
    description: 'Show or hide the chat sidecar.',
    run: (s) => s.set(sidecarOpenAtom, !s.get(sidecarOpenAtom)),
  },
  {
    id: 'ai.open-config',
    description: 'Open the AI companion settings (keys and models).',
    run: (s) => getController(s).openCompanion('config'),
  },
  {
    id: 'git.switch-branch',
    description: 'Check out a branch. Closes the open tabs.',
    args: { name: 'Branch name.' },
    confirm: true,
    run: async (s, a) => {
      const name = need(a, 'name')
      if (!(await getController(s).switchBranch(name)))
        throw new ActionError(`Could not switch to ${name}`)
    },
  },
]

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]))

export type Confirm = (message: string) => boolean

/** Runs an action by id. Throws `ActionError` for anything the caller should be told. */
export async function runAction(
  store: Store,
  id: string,
  args: Record<string, string> = {},
  confirm: Confirm = (m) => window.confirm(m),
): Promise<string> {
  const action = BY_ID.get(id)
  if (!action) throw new ActionError(`Unknown action: ${id}. Use list_actions.`)
  if (action.confirm && !confirm(`${action.description} Allow this?`)) {
    throw new ActionError('The user declined this action.')
  }
  return (await action.run(store, args)) ?? `Done: ${action.id}.`
}

/** One line per action, with its arguments, for the model. */
export function describeActions(): string {
  return ACTIONS.map((a) => {
    const args = a.args
      ? ` (${Object.entries(a.args)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ')})`
      : ''
    return `${a.id}: ${a.description}${args}${a.confirm ? ' [asks the user first]' : ''}`
  }).join('\n')
}
