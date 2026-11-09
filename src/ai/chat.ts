import { atom, type createStore } from 'jotai'
import { resolveStage } from '../router/router'
import type { ChatMessage, ProviderAdapter } from '../providers'

export interface ChatEntry {
  id: number
  role: 'user' | 'assistant'
  content: string
  /** Set when the reply failed; `content` keeps whatever arrived before. */
  error?: string
}

type Store = ReturnType<typeof createStore>
type Resolve = typeof resolveStage

export const chatMessagesAtom = atom<ChatEntry[]>([])
export const chatBusyAtom = atom(false)

export const CHAT_SYSTEM =
  'You are the AI companion inside Daedalus, a browser code editor. Answer concisely and ' +
  'accurately. Use Markdown code fences for code. If you are unsure, say so.'

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
): Promise<void> {
  const prompt = text.trim()
  if (!prompt || store.get(chatBusyAtom)) return
  const history: ChatMessage[] = store
    .get(chatMessagesAtom)
    .filter((m) => !m.error && m.content)
    .map((m) => ({ role: m.role, content: m.content }))
  const reply: ChatEntry = { id: nextId++, role: 'assistant', content: '' }
  store.set(chatMessagesAtom, (m) => [
    ...m,
    { id: nextId++, role: 'user', content: prompt },
    reply,
  ])
  store.set(chatBusyAtom, true)
  const ctl = new AbortController()
  current = ctl
  const patch = (fn: (e: ChatEntry) => ChatEntry) =>
    store.set(chatMessagesAtom, (m) => m.map((e) => (e.id === reply.id ? fn(e) : e)))
  try {
    const { adapter, route } = await resolve('plan')
    for await (const chunk of (adapter as ProviderAdapter).stream(
      {
        model: route.model,
        system: CHAT_SYSTEM,
        messages: [...history, { role: 'user', content: prompt }],
      },
      ctl.signal,
    )) {
      patch((e) => ({ ...e, content: e.content + chunk }))
    }
  } catch (e) {
    if (!ctl.signal.aborted) {
      const error = e instanceof Error ? e.message : 'The request failed'
      patch((x) => ({ ...x, error }))
    }
  } finally {
    if (current === ctl) current = null
    store.set(chatBusyAtom, false)
  }
}

/** Ends the reply in progress, keeping the text received so far. */
export function stopChat() {
  current?.abort()
}

export function clearChat(store: Store) {
  stopChat()
  store.set(chatMessagesAtom, [])
}
