import { atom, type createStore } from 'jotai'
import { resolveRoute, resolveStage } from '../router/router'
import type { AgentMessage, ProviderAdapter, ToolCall, ToolResult } from '../providers'
import { runLoop, stopMessage } from './agentLoop'
import type { RunBudget } from './agentLoop'
import {
  COMPANION_TOOLS,
  controllerHost,
  READ_ONLY_TOOLS,
  runTool,
} from './companionTools'
import type { ToolHost } from './companionTools'
import { compactResults, replayContent } from './summarize'
import { loadProjectContext } from './agents/loadAgents'
import { agentCatalog, RUN_AGENT, RUN_AGENT_DEF, runSubAgent } from './agents/subAgents'

/** A tool the model called, with its result once it has run. */
export interface ChatCall {
  call: ToolCall
  result?: ToolResult
  /** Live status of a delegated run (`grep: Read src/a.ts`), then its totals. */
  progress?: string
  /** A short stand-in for a large result, replayed in later turns instead of the full text. */
  summary?: string
}

export interface ChatEntry {
  id: number
  role: 'user' | 'assistant'
  content: string
  /** Tools this reply called. The next reply in the same turn continues from their results. */
  calls?: ChatCall[]
  /** Set when the reply failed; `content` keeps whatever arrived before. */
  error?: string
  /** A message from the app (command output), shown in the log but never sent to the model. */
  notice?: boolean
  /** The finished plan of a plan-mode turn. The user can ask for it to be carried out. */
  plan?: boolean
}

/**
 * `agent` does the work: it reads, edits and writes files. `plan` only looks, and ends with a
 * plan for the user to approve. Agent is the default; plan is used when the user asks for it.
 */
export type ChatMode = 'agent' | 'plan'

type Store = ReturnType<typeof createStore>
type Resolve = typeof resolveStage

export const chatMessagesAtom = atom<ChatEntry[]>([])
export const chatBusyAtom = atom(false)
export const chatModeAtom = atom<ChatMode>('agent')

export const CHAT_SYSTEM =
  'You are the AI companion inside Daedalus, a browser code editor. You work on the open ' +
  'workspace with tools: list_files, read_file and search_text to look, edit_file and ' +
  'write_file to change files, and list_actions / run_action for editor actions the user ' +
  'has too (tabs, theme, Vim mode, branches). Answer concisely and accurately, use Markdown ' +
  'code fences for code, and say so when you are unsure.'

const AGENT_SYSTEM =
  '\n\nWhen the user asks you to write code, implement a feature or fix a bug, do the work ' +
  'yourself rather than describing it. Find and read the relevant files first, and follow ' +
  'the conventions you see there. Then make every change the task needs with edit_file ' +
  '(a small `search` that occurs once) or write_file (new files), including tests and ' +
  'call sites. If an edit fails, read the file again and retry. You cannot run commands, ' +
  'so check your work by re-reading what you changed. Edits apply at once and the user can ' +
  'undo them with Ctrl-Z. Finish with a short summary: what changed, in which files, and ' +
  'anything the user should run or check. Do not claim a change you did not make. A ' +
  'question is answered, not turned into edits.'

const PLAN_SYSTEM =
  '\n\nPlan mode is on: you must not change anything. Only the read tools are available. ' +
  'Investigate the workspace as far as the request needs, then reply with a plan the user ' +
  'can approve: the goal in one line, the files to change or create with what changes in ' +
  'each, the order of the steps, and open questions or risks. Keep it concrete and brief. ' +
  'Do not write the full code. The user will ask you to implement the plan or to revise it.'

/** What the user's "Implement plan" sends once they approve a plan. */
export const IMPLEMENT_PROMPT = 'The plan is approved. Implement it now.'

/**
 * Limits for one chat turn. Implementing a feature takes many reads and edits, so this is
 * well above the loop's default; Stop ends a turn sooner.
 */
export const CHAT_BUDGET: RunBudget = {
  maxSteps: 40,
  maxMs: 600_000,
  maxTokens: 1_000_000,
}

/** A turn is stopped after this many model calls, so a confused model cannot loop forever. */
export const MAX_STEPS = CHAT_BUDGET.maxSteps

const PLAN_REFUSAL =
  'Plan mode is on: nothing can be changed. Reply with the plan instead.'

let nextId = 1
let current: AbortController | null = null

/** What Chat needs to say when the problem is setup, not the request. */
export const NEEDS_CONFIG = /vault is locked|no api key|no vault|no model|missing/i
/** A locked vault is fixed by a passphrase, which the chat can ask for itself. */
export const NEEDS_UNLOCK = /vault is locked/i

/** Sends the last message again, replacing its failed reply. For after a setup problem is fixed. */
export async function retryChat(store: Store, resolve?: Resolve, host?: ToolHost) {
  if (store.get(chatBusyAtom)) return
  const all = store.get(chatMessagesAtom)
  const i = all.map((e) => e.role).lastIndexOf('user')
  if (i < 0) return
  const prompt = all[i]!.content
  store.set(chatMessagesAtom, all.slice(0, i))
  await sendChat(store, prompt, resolve, host)
}

/**
 * Adds the user's message and an empty reply at once (so the screen changes in the same
 * frame), then streams the reply from the Plan model into the last entry. In `plan` mode
 * the model gets only the read tools and its final reply is marked as a plan.
 */
export async function sendChat(
  store: Store,
  text: string,
  resolve: Resolve = resolveStage,
  host?: ToolHost,
  routeFor: typeof resolveRoute = resolveRoute,
  mode: ChatMode = store.get(chatModeAtom),
): Promise<void> {
  const prompt = text.trim()
  if (!prompt || store.get(chatBusyAtom)) return
  const history = toAgentMessages(store.get(chatMessagesAtom))
  const reply: ChatEntry = { id: nextId++, role: 'assistant', content: '' }
  store.set(chatMessagesAtom, (m) => [
    ...m,
    { id: nextId++, role: 'user', content: prompt },
    reply,
  ])
  store.set(chatBusyAtom, true)
  const ctl = new AbortController()
  current = ctl
  const patch = (id: number, fn: (e: ChatEntry) => ChatEntry) =>
    store.set(chatMessagesAtom, (m) => m.map((e) => (e.id === id ? fn(e) : e)))
  try {
    const { adapter, route } = await resolve('plan')
    const a = adapter as ProviderAdapter
    const planning = mode === 'plan'
    const modeSystem = CHAT_SYSTEM + (planning ? PLAN_SYSTEM : AGENT_SYSTEM)
    const messages: AgentMessage[] = [...history, { role: 'user', content: prompt }]
    if (!a.chat) {
      // A provider without tool calling still answers in plain text.
      const plain = messages.flatMap((m) =>
        m.role === 'tool' ? [] : [{ role: m.role, content: m.content }],
      )
      for await (const chunk of a.stream(
        { model: route.model, system: modeSystem, messages: plain },
        ctl.signal,
      )) {
        patch(reply.id, (e) => ({ ...e, content: e.content + chunk }))
      }
      if (planning && !ctl.signal.aborted) patch(reply.id, (e) => ({ ...e, plan: true }))
      return
    }
    const full = host ?? controllerHost(store)
    // Plan mode cannot change anything, whatever the model or a sub-agent asks for.
    const tools: ToolHost = planning
      ? {
          tree: () => full.tree(),
          read: (path) => full.read(path),
          search: (query) => full.search(query),
          write: () => Promise.reject(new Error(PLAN_REFUSAL)),
        }
      : full
    let entry = reply
    const budget = CHAT_BUDGET
    const spend = { tokens: 0 }
    const project = await loadProjectContext(tools)
    if (ctl.signal.aborted) return
    const system =
      modeSystem +
      agentCatalog(project.agents) +
      (project.rules ? `\n\nProject rules (AGENTS.md):\n${project.rules}` : '')
    const own = planning
      ? COMPANION_TOOLS.filter((t) => READ_ONLY_TOOLS.includes(t.name))
      : COMPANION_TOOLS
    const toolDefs = project.agents.length ? [...own, RUN_AGENT_DEF] : own
    const allowed = new Set(toolDefs.map((t) => t.name))
    const progress = (id: string, text: string) =>
      patch(entry.id, (e) => ({
        ...e,
        calls: (e.calls ?? []).map((c) =>
          c.call.id === id ? { ...c, progress: text } : c,
        ),
      }))
    const { stop } = await runLoop({
      adapter: a,
      model: route.model,
      system,
      tools: toolDefs,
      messages,
      budget,
      spend,
      signal: ctl.signal,
      exec: (call) =>
        call.name === RUN_AGENT
          ? runSubAgent(
              {
                agents: project.agents,
                host: tools,
                parent: { adapter: a, model: route.model },
                resolveRoute: routeFor,
                spend,
                parentBudget: budget,
                signal: ctl.signal,
                onProgress: progress,
              },
              call,
            )
          : allowed.has(call.name)
            ? runTool(tools, call)
            : Promise.resolve({
                id: call.id,
                name: call.name,
                content: PLAN_REFUSAL,
                isError: true,
              }),
      hooks: {
        onText: (t) => patch(entry.id, (e) => ({ ...e, content: e.content + t })),
        onCall: (call) =>
          patch(entry.id, (e) => ({ ...e, calls: [...(e.calls ?? []), { call }] })),
        onResult: (call, result) =>
          patch(entry.id, (e) => ({
            ...e,
            calls: (e.calls ?? []).map((c) =>
              c.call.id === call.id ? { ...c, result } : c,
            ),
          })),
        onNextStep: () => {
          const next: ChatEntry = { id: nextId++, role: 'assistant', content: '' }
          store.set(chatMessagesAtom, (m) => [...m, next])
          entry = next
        },
      },
    })
    const error = stopMessage(stop, budget)
    if (error) patch(entry.id, (e) => ({ ...e, error }))
    else if (planning && stop === 'done')
      patch(entry.id, (e) => (e.content.trim() ? { ...e, plan: true } : e))
    // Shrinks big tool results for later turns without delaying this one.
    if (!ctl.signal.aborted) void compactResults(store, resolve)
  } catch (e) {
    if (!ctl.signal.aborted) {
      const error = e instanceof Error ? e.message : 'The request failed'
      // The error belongs to whichever reply of the turn was in progress: the last one.
      const last = store.get(chatMessagesAtom).at(-1)
      patch(last?.id ?? reply.id, (x) => ({ ...x, error }))
    }
  } finally {
    if (current === ctl) current = null
    store.set(chatBusyAtom, false)
  }
}

/**
 * The conversation as the model should see it. A reply's calls count only once they have
 * results (a stopped turn can leave some without); failed replies are left out.
 */
export function toAgentMessages(entries: ChatEntry[]): AgentMessage[] {
  const out: AgentMessage[] = []
  for (const m of entries) {
    if (m.error || m.notice) continue
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    const done = (m.calls ?? []).filter((c) => c.result)
    if (!m.content && !done.length) continue
    out.push({
      role: 'assistant',
      content: m.content,
      ...(done.length ? { calls: done.map((c) => c.call) } : {}),
    })
    if (done.length) {
      out.push({
        role: 'tool',
        results: done.flatMap((c) =>
          c.result
            ? [
                {
                  ...c.result,
                  ...(c.summary ? { content: replayContent(c.summary) } : {}),
                },
              ]
            : [],
        ),
      })
    }
  }
  return out
}

/** Carries out the plan the user approved: back to agent mode, with the edit tools. */
export async function implementPlan(store: Store, resolve?: Resolve, host?: ToolHost) {
  if (store.get(chatBusyAtom)) return
  store.set(chatModeAtom, 'agent')
  await sendChat(store, IMPLEMENT_PROMPT, resolve, host, undefined, 'agent')
}

/** Shows a line from the app in the log. It is not part of the conversation the model sees. */
export function addNotice(store: Store, content: string) {
  store.set(chatMessagesAtom, (m) => [
    ...m,
    { id: nextId++, role: 'assistant', content, notice: true },
  ])
}

export const SUMMARIZE_PROMPT =
  'Summarize our conversation so far for your own later use: the goal, decisions made, ' +
  'files read or changed, and open questions. Be brief and factual.'

/**
 * Asks the model for a summary, then replaces the history with it, so later turns carry the
 * gist instead of every message and tool result.
 */
export async function summarizeChat(store: Store, resolve?: Resolve, host?: ToolHost) {
  if (store.get(chatBusyAtom)) return
  if (!toAgentMessages(store.get(chatMessagesAtom)).length) {
    addNotice(store, 'Nothing to summarize yet.')
    return
  }
  await sendChat(store, SUMMARIZE_PROMPT, resolve, host)
  const last = store.get(chatMessagesAtom).at(-1)
  if (!last || last.error || !last.content.trim()) return
  store.set(chatMessagesAtom, [
    { id: nextId++, role: 'user', content: 'Summary of our conversation so far:' },
    { id: nextId++, role: 'assistant', content: last.content },
  ])
}

/** Ends the reply in progress, keeping the text received so far. */
export function stopChat() {
  current?.abort()
}

export function clearChat(store: Store) {
  stopChat()
  store.set(chatMessagesAtom, [])
}
