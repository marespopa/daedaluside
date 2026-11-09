import { MissingKeyError, resolveStage } from '../router/router'

/** How much of the file around the cursor goes to the model. Keeps the request small and fast. */
const PREFIX_CHARS = 4000
const SUFFIX_CHARS = 1000
const MAX_LINES = 3
const MAX_CHARS = 300

export interface CompletionContext {
  prefix: string
  suffix: string
  filename?: string
}

type Resolve = typeof resolveStage

const SYSTEM =
  'You complete code at the cursor, marked <CURSOR>. Reply with only the text to insert at ' +
  'the cursor: no explanation, no code fences, and do not repeat the text before the cursor. ' +
  'Keep it short, a few lines at most. Reply with nothing if no completion is useful.'

/** Drops code fences and trims a reply to a short insertion. Returns null when nothing is left. */
export function cleanCompletion(raw: string): string | null {
  let text = raw.replace(/^```[\w-]*\n?/, '').replace(/\n?```\s*$/, '')
  if (!text.trim()) return null
  text = text.split('\n').slice(0, MAX_LINES).join('\n').slice(0, MAX_CHARS)
  return text.replace(/\s+$/, '') || null
}

/**
 * Asks the Edit model (or the Plan model when the Edit model has no key) for text to insert at the cursor. Resolves to null when there is nothing to
 * offer or the request was aborted. Throws if the vault is locked or no key is saved, so the caller
 * can stay quiet.
 */
export async function requestCompletion(
  ctx: CompletionContext,
  signal: AbortSignal,
  resolve: Resolve = resolveStage,
): Promise<string | null> {
  // The Edit model may point at a provider with no key (only one key is saved, say). The Plan
  // model is the one the chat already uses, so fall back to it rather than show nothing.
  const { adapter, route } = await resolve('execute').catch((e: unknown) => {
    if (e instanceof MissingKeyError) return resolve('plan')
    throw e
  })
  if (signal.aborted) return null
  const prefix = ctx.prefix.slice(-PREFIX_CHARS)
  const suffix = ctx.suffix.slice(0, SUFFIX_CHARS)
  const file = ctx.filename ? `File: ${ctx.filename}\n\n` : ''
  let out = ''
  try {
    for await (const chunk of adapter.stream(
      {
        model: route.model,
        system: SYSTEM,
        messages: [{ role: 'user', content: `${file}${prefix}<CURSOR>${suffix}` }],
        maxTokens: 96,
        temperature: 0,
      },
      signal,
    )) {
      out += chunk
      // Enough for a suggestion: stop paying for more.
      if (out.split('\n').length > MAX_LINES + 1 || out.length > MAX_CHARS * 2) break
    }
  } catch (e) {
    if (signal.aborted) return null
    throw e
  }
  return signal.aborted ? null : cleanCompletion(out)
}
