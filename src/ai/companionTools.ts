import type { createStore } from 'jotai'
import { treeAtom } from '../state/workspaceAtoms'
import type { ToolCall, ToolDef, ToolResult } from '../providers'
import { getController } from '../workspace/controller'
import type { GrepHit } from '../workspace/grep'
import type { Entry } from '../workspace/types'
import { checkPath } from '../workflow/patches'

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
  }
}

const MAX_READ = 60_000
const MAX_WRITE = 200_000
const MAX_FILES = 300
const MAX_HITS = 50

const str = { type: 'string' }

export const COMPANION_TOOLS: ToolDef[] = [
  {
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
  {
    name: 'read_file',
    description:
      'Read a text file from the workspace. Reflects unsaved edits in open tabs.',
    parameters: {
      type: 'object',
      properties: { path: { ...str, description: 'Workspace-relative path.' } },
      required: ['path'],
    },
  },
  {
    name: 'search_text',
    description:
      'Search every file for a text string. Returns path:line: text for each match.',
    parameters: {
      type: 'object',
      properties: { query: str },
      required: ['query'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace one exact piece of text in an existing file. `search` must match exactly once; include enough surrounding lines to make it unique. Prefer this over write_file for changes.',
    parameters: {
      type: 'object',
      properties: { path: str, search: str, replace: str },
      required: ['path', 'search', 'replace'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create a file, or replace a whole existing file with new content. The user can undo with Ctrl-Z.',
    parameters: {
      type: 'object',
      properties: { path: str, content: str },
      required: ['path', 'content'],
    },
  },
]

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

async function run(host: ToolHost, call: ToolCall): Promise<string> {
  switch (call.name) {
    case 'list_files': {
      const raw = call.args.dir
      const dir =
        typeof raw === 'string' && raw.trim() ? safePath(raw).replace(/\/$/, '') : ''
      const files = (await host.tree())
        .filter(
          (e) =>
            e.kind === 'file' &&
            (dir === '' || e.path.startsWith(`${dir}/`)) &&
            !e.path.split('/').some((s) => s.toLowerCase() === '.git'),
        )
        .map((e) => e.path)
        .sort()
      const shown = files.slice(0, MAX_FILES).join('\n')
      return files.length > MAX_FILES
        ? `${shown}\n… ${files.length - MAX_FILES} more; list a subfolder to see them.`
        : shown || 'No files.'
    }
    case 'read_file': {
      const path = safePath(arg(call, 'path'))
      const text = await host.read(path)
      if (text === null) throw new ToolError(`Cannot read ${path}`)
      return text.length > MAX_READ
        ? `${text.slice(0, MAX_READ)}\n… truncated; the file has ${text.length} characters.`
        : text
    }
    case 'search_text': {
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
    }
    case 'edit_file': {
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
    }
    case 'write_file': {
      const path = safePath(arg(call, 'path'))
      const content = arg(call, 'content')
      if (content.length > MAX_WRITE) throw new ToolError('Content is too large')
      const base = await host.read(path)
      if (base === content) return `No change: ${path} already has that content.`
      if (!(await host.write(path, base, content)))
        throw new ToolError(`Could not write ${path}`)
      return base === null ? `Created ${path}.` : `Replaced ${path}.`
    }
    default:
      throw new ToolError(`Unknown tool: ${call.name}`)
  }
}

/** Runs one tool call. A failure becomes an error result the model can read and recover from. */
export async function runTool(host: ToolHost, call: ToolCall): Promise<ToolResult> {
  try {
    return { id: call.id, name: call.name, content: await run(host, call) }
  } catch (e) {
    const content = e instanceof Error ? e.message : 'The tool failed'
    return { id: call.id, name: call.name, content, isError: true }
  }
}

/** Short label for the chat log, e.g. `Edit src/a.ts`. */
export function describeCall(call: ToolCall): string {
  const a = call.args
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  switch (call.name) {
    case 'list_files':
      return `List files${s('dir') ? ` in ${s('dir')}` : ''}`
    case 'read_file':
      return `Read ${s('path')}`
    case 'search_text':
      return `Search for “${s('query')}”`
    case 'edit_file':
      return `Edit ${s('path')}`
    case 'write_file':
      return `Write ${s('path')}`
    default:
      return call.name
  }
}
