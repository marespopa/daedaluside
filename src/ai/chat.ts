import { atom, type createStore } from 'jotai'
import { resolveStage } from '../router/router'
import type { AgentMessage, ProviderAdapter, ToolCall, ToolResult } from '../providers'
import { COMPANION_TOOLS, controllerHost, runTool } from './companionTools'
import type { ToolHost } from './companionTools'

/** A tool the model called, with its result once it has run. */
export interface ChatCall {
  call: ToolCall
  result?: ToolResult
}

export interface ChatEntry {
  id: number
  role: 'user' | 'assistant'
  content: string
  /** Tools this reply called. The next reply in the same turn continues from their results. */
  calls?: ChatCall[]
  /** Set when the reply failed; `content` keeps whatever arrived before. */
  error?: string
}

type Store = ReturnType<typeof createStore>
type Resolve = typeof resolveStage

export const chatMessagesAtom = atom<ChatEntry[]>([])
export const chatBusyAtom = atom(false)

export const CHAT_SYSTEM =
  'You are the AI companion inside Daedalus, a browser code editor. Answer concisely and ' +
  'accurately. Use Markdown code fences for code. If you are unsure, say so.\n\n' +
  'You can use tools on the open workspace: list_files, read_file, search_text, edit_file ' +
  'and write_file. Read the relevant files before answering questions about them. Edit or ' +
  'write files only when the user asks for a change; prefer edit_file with a small, unique ' +
  '`search`. Edits are applied at once and the user can undo them with Ctrl-Z. After ' +
  'editing, say briefly what you changed. Do not claim a change you did not make.'

/** A turn is stopped after this many model calls, so a confused model cannot loop forever. */
export const MAX_STEPS = 12

let nextId = 1
let current: AbortController | null = null

/** What Chat needs to say when the problem is setup, not the request. */
export const NEEDS_CONFIG = /vault is locked|no api key|no vault|missing/i

/**
 * Adds the user's message and an empty reply at once (so the screen changes in the same
 * frame), then streams the reply from the Plan model into the last entry.
 */
export async function sendChat(
  store: Store,
  text: string,
  resolve: Resolve = resolveStage,
  host?: ToolHost,
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
    const messages: AgentMessage[] = [...history, { role: 'user', content: prompt }]
    if (!a.chat) {
      // A provider without tool calling still answers in plain text.
      const plain = messages.flatMap((m) =>
        m.role === 'tool' ? [] : [{ role: m.role, content: m.content }],
      )
      for await (const chunk of a.stream(
        { model: route.model, system: CHAT_SYSTEM, messages: plain },
        ctl.signal,
      )) {
        patch(reply.id, (e) => ({ ...e, content: e.content + chunk }))
      }
      return
    }
    const tools = host ?? controllerHost(store)
    let entry = reply
    for (let step = 1; ; step++) {
      const calls: ToolCall[] = []
      let text = ''
      for await (const ev of a.chat(
        { model: route.model, system: CHAT_SYSTEM, messages, tools: COMPANION_TOOLS },
        ctl.signal,
      )) {
        if (ev.type === 'text') {
          text += ev.text
          patch(entry.id, (e) => ({ ...e, content: e.content + ev.text }))
        } else {
          calls.push(ev.call)
          patch(entry.id, (e) => ({
            ...e,
            calls: [...(e.calls ?? []), { call: ev.call }],
          }))
        }
      }
      if (!calls.length) return
      const results: ToolResult[] = []
      for (const call of calls) {
        if (ctl.signal.aborted) return
        const result = await runTool(tools, call)
        results.push(result)
        patch(entry.id, (e) => ({
          ...e,
          calls: (e.calls ?? []).map((c) =>
            c.call.id === call.id ? { ...c, result } : c,
          ),
        }))
      }
      if (ctl.signal.aborted) return
      if (step >= MAX_STEPS) {
        patch(entry.id, (e) => ({ ...e, error: `Stopped after ${MAX_STEPS} steps.` }))
        return
      }
      messages.push(
        { role: 'assistant', content: text, calls },
        { role: 'tool', results },
      )
      const next: ChatEntry = { id: nextId++, role: 'assistant', content: '' }
      store.set(chatMessagesAtom, (m) => [...m, next])
      entry = next
    }
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
    if (m.error) continue
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
        results: done.flatMap((c) => (c.result ? [c.result] : [])),
      })
    }
  }
  return out
}

/** Ends the reply in progress, keeping the text received so far. */
export function stopChat() {
  current?.abort()
}

export function clearChat(store: Store) {
  stopChat()
  store.set(chatMessagesAtom, [])
}
