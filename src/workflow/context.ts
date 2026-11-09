export interface ContextFile {
  path: string
  content: string
}

export interface ContextInput {
  activePath: string | null
  openFiles: ContextFile[]
  /** Workspace-relative paths for the summary. The caller drops ignored folders. */
  treePaths: string[]
  /** Optional project rules, e.g. the contents of AGENTS.md. */
  rules?: string
  /** Rough cap on the text sent, in characters (about 4 per token). */
  budgetChars?: number
}

export const DEFAULT_BUDGET = 60_000
const MAX_TREE_PATHS = 300
const TRUNCATED = '\n[truncated]'

/** Text for the model: rules, a file list, then the open files with the active one first. */
export function buildContext(input: ContextInput): string {
  let left = input.budgetChars ?? DEFAULT_BUDGET
  const parts: string[] = []
  const add = (text: string) => {
    parts.push(text)
    left -= text.length
  }

  if (input.rules?.trim()) add(`<rules>\n${input.rules.trim().slice(0, 4000)}\n</rules>`)

  const shown = input.treePaths.slice(0, MAX_TREE_PATHS)
  const more = input.treePaths.length - shown.length
  add(`<files>\n${shown.join('\n')}${more > 0 ? `\n… and ${more} more` : ''}\n</files>`)

  const ordered = [...input.openFiles].sort(
    (a, b) => Number(b.path === input.activePath) - Number(a.path === input.activePath),
  )
  for (const f of ordered) {
    const open = `<file path="${f.path}">\n`
    const close = '\n</file>'
    const room = left - open.length - close.length - TRUNCATED.length
    if (room <= 0) break
    const body =
      f.content.length > room ? f.content.slice(0, room) + TRUNCATED : f.content
    add(open + body + close)
  }
  return parts.join('\n\n')
}

/** Paths the plan names in backticks, e.g. `src/a.ts`. Used to load files the execute step must see. */
export function referencedPaths(plan: string, max = 12): string[] {
  const found = new Set<string>()
  for (const m of plan.matchAll(/`([^`\s]+)`/g)) {
    const p = m[1]!
    if (/^[\w./@-]+$/.test(p) && (p.includes('/') || /\.\w+$/.test(p)))
      found.add(p.replace(/^\.\//, ''))
    if (found.size >= max) break
  }
  return [...found]
}
