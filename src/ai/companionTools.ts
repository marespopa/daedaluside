import type { createStore } from 'jotai'
import { treeAtom } from '../state/workspaceAtoms'
import type { ToolCall, ToolDef, ToolResult } from '../providers'
import { getController } from '../workspace/controller'
import type { GrepHit } from '../workspace/grep'
import type { Entry } from '../workspace/types'
import { checkPath } from '../workflow/patches'
import { ActionError, describeActions, runAction } from '../actions/registry'

type Store = ReturnType<typeof createStore>

/** What the tools need from the workspace. The controller provides it; tests fake it. */
export interface ToolHost {
  /** Resolves once the tree holds every file. */
  tree(): Promise<Entry[]>
  /** The live text of a file (open buffer first), or null when it cannot be read. */
  read(path: string): Promise<string | null>
  search(query: string): Promise<{ hits: GrepHit[]; truncated: boolean }>
  /** Writes through the editor buffers, so Ctrl-Z undoes it. `base` is null for a new file. */
  write(path: string, base: string | null, content: string): Promise<boolean>
  /** Editor actions the user can also run from the palette. Absent where there is no editor. */
  actions?: {
    list(): string
    run(id: string, args: Record<string, string>): Promise<string>
  }
}

export function controllerHost(store: Store): ToolHost {
  const c = getController(store)
  return {
    async tree() {
      await c.ensureFullTree()
      return store.get(treeAtom)
    },
    read: (path) => c.readForPreview(path),
    search: (query) =>
      new Promise((resolve) => {
        const hits: GrepHit[] = []
        c.grepComplete(
          query,
          (batch) => hits.push(...batch),
          (truncated) => resolve({ hits, truncated }),
        )
      }),
    write: (path, base, content) => c.applyPatches([{ path, base, content }]),
    actions: {
      list: describeActions,
      run: async (id, args) => {
        try {
          return await runAction(store, id, args)
        } catch (e) {
          throw e instanceof ActionError ? new ToolError(e.message) : e
        }
      },
    },
  }
}

const MAX_READ = 60_000
const MAX_WRITE = 200_000
const MAX_FILES = 300
const MAX_HITS = 50

const str = { type: 'string' }

class ToolError extends Error {}

function arg(call: ToolCall, key: string): string {
  const v = call.args[key]
  if (typeof v !== 'string') throw new ToolError(`"${key}" must be a string`)
  return v
}

function safePath(raw: string): string {
  try {
    return checkPath(raw)
  } catch {
    throw new ToolError(`Path is not allowed: ${raw}`)
  }
}

function count(text: string, needle: string): number {
  let n = 0
  for (
    let i = text.indexOf(needle);
    i !== -1;
    i = text.indexOf(needle, i + needle.length)
  )
    n++
  return n
}

/** One tool: its schema, what it does, and how the chat log labels a call. Add a tool here only. */
export interface Tool {
  def: ToolDef
  run(host: ToolHost, call: ToolCall): Promise<string>
  describe(call: ToolCall): string
}

const s = (call: ToolCall, k: string) =>
  typeof call.args[k] === 'string' ? (call.args[k] as string) : ''

const TOOLS: Tool[] = [
  {
    def: {
      name: 'list_files',
      description:
        'List files in the open workspace, optionally under one folder. Returns workspace-relative paths.',
      parameters: {
        type: 'object',
        properties: {
          dir: { ...str, description: 'Folder to list under; omit for the root.' },
        },
      },
    },
    async run(host, call) {
      const raw = call.args.dir
      const dir =
        typeof raw === 'string' && raw.trim() ? safePath(raw).replace(/\/$/, '') : ''
      const files = (await host.tree())
        .filter(
          (e) =>
            e.kind === 'file' &&
            (dir === '' || e.path.startsWith(`${dir}/`)) &&
            !e.path.split('/').some((seg) => seg.toLowerCase() === '.git'),
        )
        .map((e) => e.path)
        .sort()
      const shown = files.slice(0, MAX_FILES).join('\n')
      return files.length > MAX_FILES
        ? `${shown}\n… ${files.length - MAX_FILES} more; list a subfolder to see them.`
        : shown || 'No files.'
    },
    describe: (call) => `List files${s(call, 'dir') ? ` in ${s(call, 'dir')}` : ''}`,
  },
  {
    def: {
      name: 'read_file',
      description:
        'Read a text file from the workspace. Reflects unsaved edits in open tabs.',
      parameters: {
        type: 'object',
        properties: { path: { ...str, description: 'Workspace-relative path.' } },
        required: ['path'],
      },
    },
    async run(host, call) {
      const path = safePath(arg(call, 'path'))
      const text = await host.read(path)
      if (text === null) throw new ToolError(`Cannot read ${path}`)
      return text.length > MAX_READ
        ? `${text.slice(0, MAX_READ)}\n… truncated; the file has ${text.length} characters.`
        : text
    },
    describe: (call) => `Read ${s(call, 'path')}`,
  },
  {
    def: {
      name: 'search_text',
      description:
        'Search every file for a text string. Returns path:line: text for each match.',
      parameters: {
        type: 'object',
        properties: { query: str },
        required: ['query'],
      },
    },
    async run(host, call) {
      const query = arg(call, 'query')
      if (!query.trim()) throw new ToolError('"query" is empty')
      const { hits, truncated } = await host.search(query)
      if (!hits.length) return 'No matches.'
      const lines = hits
        .slice(0, MAX_HITS)
        .map((h) => `${h.path}:${h.line}: ${h.text.trim()}`)
      const more =
        hits.length > MAX_HITS || truncated ? '\n… more matches; narrow the query.' : ''
      return lines.join('\n') + more
    },
    describe: (call) => `Search for “${s(call, 'query')}”`,
  },
  {
    def: {
      name: 'edit_file',
      description:
        'Replace one exact piece of text in an existing file. `search` must match exactly once; include enough surrounding lines to make it unique. Prefer this over write_file for changes.',
      parameters: {
        type: 'object',
        properties: { path: str, search: str, replace: str },
        required: ['path', 'search', 'replace'],
      },
    },
    async run(host, call) {
      const path = safePath(arg(call, 'path'))
      const search = arg(call, 'search')
      const replace = arg(call, 'replace')
      if (!search)
        throw new ToolError('"search" is empty; use write_file to create a file')
      const base = await host.read(path)
      if (base === null)
        throw new ToolError(`${path} does not exist; use write_file to create it`)
      const n = count(base, search)
      if (n === 0) throw new ToolError(`"search" was not found in ${path}`)
      if (n > 1)
        throw new ToolError(`"search" matches ${n} times in ${path}; add more context`)
      const next = base.replace(search, () => replace)
      if (next === base) return `No change: ${path} already has that text.`
      if (next.length > MAX_WRITE) throw new ToolError('Result is too large')
      if (!(await host.write(path, base, next)))
        throw new ToolError(`Could not edit ${path}`)
      return `Edited ${path}.`
    },
    describe: (call) => `Edit ${s(call, 'path')}`,
  },
  {
    def: {
      name: 'write_file',
      description:
        'Create a file, or replace a whole existing file with new content. The user can undo with Ctrl-Z.',
      parameters: {
        type: 'object',
        properties: { path: str, content: str },
        required: ['path', 'content'],
      },
    },
    async run(host, call) {
      const path = safePath(arg(call, 'path'))
      const content = arg(call, 'content')
      if (content.length > MAX_WRITE) throw new ToolError('Content is too large')
      const base = await host.read(path)
      if (base === content) return `No change: ${path} already has that content.`
      if (!(await host.write(path, base, content)))
        throw new ToolError(`Could not write ${path}`)
      return base === null ? `Created ${path}.` : `Replaced ${path}.`
    },
    describe: (call) => `Write ${s(call, 'path')}`,
  },
  {
    def: {
      name: 'list_actions',
      description:
        'List editor actions you can run with run_action: the same ones the user has in the command palette (tabs, theme, Vim mode, branch switching and more).',
      parameters: { type: 'object', properties: {} },
    },
    async run(host) {
      if (!host.actions) throw new ToolError('Editor actions are not available here')
      return host.actions.list()
    },
    describe: () => 'List actions',
  },
  {
    def: {
      name: 'run_action',
      description:
        'Run one editor action by id (see list_actions). Some ask the user to confirm first; if they decline, do not retry.',
      parameters: {
        type: 'object',
        properties: {
          id: str,
          args: {
            type: 'object',
            description: 'Named string arguments the action lists, if any.',
            additionalProperties: str,
          },
        },
        required: ['id'],
      },
    },
    async run(host, call) {
      if (!host.actions) throw new ToolError('Editor actions are not available here')
      const raw = call.args.args
      const args: Record<string, string> = {}
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') args[k] = v
      }
      return host.actions.run(arg(call, 'id'), args)
    },
    describe: (call) => `Run action ${s(call, 'id')}`,
  },
]

const BY_NAME = new Map(TOOLS.map((t) => [t.def.name, t]))

export const COMPANION_TOOLS: ToolDef[] = TOOLS.map((t) => t.def)

/** Runs one tool call. A failure becomes an error result the model can read and recover from. */
export async function runTool(host: ToolHost, call: ToolCall): Promise<ToolResult> {
  try {
    const tool = BY_NAME.get(call.name)
    if (!tool) throw new ToolError(`Unknown tool: ${call.name}`)
    return { id: call.id, name: call.name, content: await tool.run(host, call) }
  } catch (e) {
    const content = e instanceof Error ? e.message : 'The tool failed'
    return { id: call.id, name: call.name, content, isError: true }
  }
}

/** Short label for the chat log, e.g. `Edit src/a.ts`. */
export function describeCall(call: ToolCall): string {
  if (call.name === 'run_agent') {
    const task = s(call, 'task').replace(/\s+/g, ' ')
    return `Agent ${s(call, 'agent')}: ${task.length > 60 ? `${task.slice(0, 60)}…` : task}`
  }
  return BY_NAME.get(call.name)?.describe(call) ?? call.name
}
