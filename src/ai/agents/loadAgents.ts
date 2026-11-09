import type { ToolHost } from '../companionTools'
import { parseAgent } from './parseAgent'
import type { AgentDef } from './parseAgent'

const DIRS = ['.claude/agents/', '.opencode/agents/']
const MAX_AGENTS = 20
const MAX_RULES = 8000

export interface ProjectContext {
  agents: AgentDef[]
  /** The repo's AGENTS.md, if any. */
  rules: string | undefined
}

/** Agent files in the open repo. `.claude/agents` wins over `.opencode/agents` on a name clash. */
export async function loadAgents(host: ToolHost): Promise<AgentDef[]> {
  const paths = (await host.tree())
    .filter((e) => e.kind === 'file' && /\.md$/i.test(e.path))
    .map((e) => e.path)
    .filter((p) => DIRS.some((d) => p.startsWith(d) && !p.slice(d.length).includes('/')))
    .sort(
      (a, b) =>
        DIRS.findIndex((d) => a.startsWith(d)) - DIRS.findIndex((d) => b.startsWith(d)),
    )
  const out = new Map<string, AgentDef>()
  for (const path of paths) {
    if (out.size >= MAX_AGENTS) break
    const text = await host.read(path).catch(() => null)
    const agent = text === null ? null : parseAgent(path, text)
    if (agent && !out.has(agent.name.toLowerCase()))
      out.set(agent.name.toLowerCase(), agent)
  }
  return [...out.values()]
}

const CACHE_MS = 30_000
const cache = new WeakMap<ToolHost, { at: number; value: Promise<ProjectContext> }>()

/** Agents and rules for the open repo, cached briefly so every message is not a tree walk. */
export function loadProjectContext(host: ToolHost): Promise<ProjectContext> {
  const hit = cache.get(host)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const value = (async (): Promise<ProjectContext> => {
    const [agents, rules] = await Promise.all([
      loadAgents(host).catch(() => []),
      host.read('AGENTS.md').catch(() => null),
    ])
    return { agents, rules: rules?.trim() ? rules.slice(0, MAX_RULES) : undefined }
  })()
  cache.set(host, { at: Date.now(), value })
  return value
}
