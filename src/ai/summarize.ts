import type { createStore } from 'jotai'
import type { ProviderAdapter } from '../providers'
import type { resolveStage } from '../router/router'
import { chatMessagesAtom } from './chat'
import { describeCall } from './companionTools'

type Store = ReturnType<typeof createStore>

/** Tool output longer than this is compressed for later turns. */
export const SUMMARY_THRESHOLD = 4000
/** Only reads are compressed; an edit's result is already one line. */
const SUMMARIZED = new Set(['read_file', 'search_text', 'list_files'])
const COOLDOWN_MS = 5 * 60_000

const SYSTEM =
  'You compress tool output for an AI coding assistant that already used it. Keep file paths, ' +
  'line numbers, identifiers, signatures and errors. Drop boilerplate. At most 150 words. ' +
  'Output only the summary.'

const busy = new Set<string>()
let failedAt = 0

/**
 * Compresses large tool results in the saved conversation with the light Execute model, so later
 * turns replay a short summary instead of whole files. The reply that used the raw output is
 * untouched, and the log still shows it. Best effort: any failure leaves the raw result.
 */
export async function compactResults(
  store: Store,
  resolve: typeof resolveStage,
): Promise<void> {
  if (Date.now() - failedAt < COOLDOWN_MS) return
  const jobs = store
    .get(chatMessagesAtom)
    .flatMap((m) => (m.error ? [] : (m.calls ?? [])))
    .filter(
      (c) =>
        c.result &&
        !c.result.isError &&
        !c.summary &&
        SUMMARIZED.has(c.call.name) &&
        c.result.content.length > SUMMARY_THRESHOLD &&
        !busy.has(c.call.id),
    )
  if (!jobs.length) return
  let adapter: ProviderAdapter
  let model: string
  try {
    const r = await resolve('execute')
    adapter = r.adapter
    model = r.route.model
  } catch {
    failedAt = Date.now()
    return
  }
  for (const job of jobs) {
    const id = job.call.id
    busy.add(id)
    try {
      let out = ''
      for await (const chunk of adapter.stream({
        model,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `${describeCall(job.call)}\n\n${job.result!.content}`,
          },
        ],
      })) {
        out += chunk
      }
      const summary = out.trim()
      if (!summary) continue
      store.set(chatMessagesAtom, (all) =>
        all.map((m) => ({
          ...m,
          ...(m.calls?.some((c) => c.call.id === id)
            ? { calls: m.calls.map((c) => (c.call.id === id ? { ...c, summary } : c)) }
            : {}),
        })),
      )
    } catch {
      failedAt = Date.now()
      return
    } finally {
      busy.delete(id)
    }
  }
}

/** What the model sees for a compressed result in later turns. */
export function replayContent(summary: string): string {
  return `[Summary of the original output, shortened to save space; call the tool again for exact text]\n${summary}`
}
