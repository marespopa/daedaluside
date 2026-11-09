import type {
  ProviderAdapter,
  ProviderId,
  ToolCall,
  ToolDef,
  ToolResult,
} from '../../providers'
import { PROVIDER_IDS } from '../../providers'
import type { Route } from '../../router/router'
import { runLoop, stopMessage } from '../agentLoop'
import type { RunBudget } from '../agentLoop'
import { COMPANION_TOOLS, describeCall, runTool } from '../companionTools'
import type { ToolHost } from '../companionTools'
import type { AgentDef } from './parseAgent'

/** Sub-runs are short and cheap by design; a file can narrow these but not raise them. */
export const SUB_BUDGET: RunBudget = { maxSteps: 8, maxMs: 90_000, maxTokens: 60_000 }

export const RUN_AGENT = 'run_agent'

export const RUN_AGENT_DEF: ToolDef = {
  name: RUN_AGENT,
  description:
    'Delegate a self-contained task to a specialized agent from this repo. It runs on its own ' +
    'with limited tools and budget, and returns only a short final report.',
  parameters: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Agent name.' },
      task: {
        type: 'string',
        description: 'Everything the agent needs; it cannot see this conversation.',
      },
    },
    required: ['agent', 'task'],
  },
}

/** Claude Code's tool names, mapped to the workspace tools that do the same. */
const TOOL_MAP: Record<string, string> = {
  read: 'read_file',
  grep: 'search_text',
  glob: 'list_files',
  ls: 'list_files',
  edit: 'edit_file',
  write: 'write_file',
}
const READ_ONLY = ['list_files', 'read_file', 'search_text']

/** The workspace tools an agent may use. With no (usable) `tools` line it is read-only. */
export function toolsFor(agent: AgentDef): ToolDef[] {
  const wanted = new Set(
    (agent.tools ?? []).flatMap((t) => TOOL_MAP[t.toLowerCase()] ?? []),
  )
  const names = wanted.size ? wanted : new Set(READ_ONLY)
  return COMPANION_TOOLS.filter((t) => names.has(t.name))
}

const ALIASES: Record<string, Route> = {
  haiku: { provider: 'anthropic', model: 'claude-haiku-5-5' },
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  opus: { provider: 'anthropic', model: 'claude-opus-5-5' },
}

/** The route an agent's `model` asks for, or null to run on the chat's own model. */
export function agentRoute(model: string | undefined): Route | null {
  if (!model) return null
  const alias = ALIASES[model.toLowerCase()]
  if (alias) return alias
  const [provider, ...rest] = model.split('/')
  if (rest.length && PROVIDER_IDS.includes(provider as ProviderId)) {
    return { provider: provider as ProviderId, model: rest.join('/') }
  }
  return null
}

/** Text for the system prompt that tells the model which agents it may delegate to. */
export function agentCatalog(agents: AgentDef[]): string {
  if (!agents.length) return ''
  return (
    '\n\nThis repo defines agents you can delegate to with run_agent. Give each a ' +
    'self-contained task; it returns a short report. Prefer them for searches and reviews ' +
    'that would otherwise fill this conversation with file contents.\n' +
    agents.map((a) => `- ${a.name}: ${a.description}`).join('\n')
  )
}

export interface SubAgentContext {
  agents: AgentDef[]
  host: ToolHost
  /** The chat's own model, used when an agent names none or its provider is not set up. */
  parent: { adapter: ProviderAdapter; model: string }
  resolveRoute(route: Route): { adapter: ProviderAdapter; route: Route }
  spend: { tokens: number }
  parentBudget: RunBudget
  signal?: AbortSignal
  /** Live status for the chat log, e.g. `Read src/a.ts`. */
  onProgress?(callId: string, text: string): void
}

/** Runs one `run_agent` call. Never throws: a problem is an error result the model can read. */
export async function runSubAgent(
  ctx: SubAgentContext,
  call: ToolCall,
): Promise<ToolResult> {
  const fail = (content: string): ToolResult => ({
    id: call.id,
    name: call.name,
    content,
    isError: true,
  })
  const name = typeof call.args.agent === 'string' ? call.args.agent : ''
  const task = typeof call.args.task === 'string' ? call.args.task.trim() : ''
  const agent = ctx.agents.find((a) => a.name.toLowerCase() === name.toLowerCase())
  if (!agent) {
    return fail(
      `Unknown agent "${name}". Available: ${ctx.agents.map((a) => a.name).join(', ')}`,
    )
  }
  if (!task) return fail('"task" is empty')

  let { adapter } = ctx.parent
  let model = ctx.parent.model
  const wanted = agentRoute(agent.model)
  if (wanted) {
    try {
      const r = ctx.resolveRoute(wanted)
      adapter = r.adapter
      model = r.route.model
    } catch {
      // Provider not set up (no key): the chat's own model does the job.
    }
  }
  if (!adapter.chat) return fail('This provider cannot run agents')

  const tools = toolsFor(agent)
  const allowed = new Set(tools.map((t) => t.name))
  const budget: RunBudget = {
    ...SUB_BUDGET,
    // One token cap covers the chat and everything it delegates.
    maxTokens: Math.min(
      ctx.parentBudget.maxTokens,
      ctx.spend.tokens + SUB_BUDGET.maxTokens,
    ),
  }
  const before = ctx.spend.tokens
  const progress = (t: string) => ctx.onProgress?.(call.id, t)
  progress(`${agent.name} starting`)
  try {
    const run = await runLoop({
      adapter,
      model,
      system:
        `${agent.prompt}\n\nYou are a sub-agent. The caller sees only your last message, ` +
        'so end with a concise report: findings first, file paths and line numbers where relevant.',
      tools,
      messages: [{ role: 'user', content: task }],
      budget,
      spend: ctx.spend,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      exec: (c) =>
        allowed.has(c.name)
          ? runTool(ctx.host, c)
          : Promise.resolve({
              id: c.id,
              name: c.name,
              content: `${agent.name} may not use ${c.name}`,
              isError: true,
            }),
      hooks: { onCall: (c) => progress(`${agent.name}: ${describeCall(c)}`) },
    })
    const used = ctx.spend.tokens - before
    progress(`${agent.name} · ${run.steps} steps · ${used} tokens`)
    const note = stopMessage(run.stop, budget)
    const body = run.text.trim() || '(no report)'
    return {
      id: call.id,
      name: call.name,
      content: note ? `${body}\n\n(${agent.name} ${note.toLowerCase()})` : body,
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The agent failed')
  }
}
