import type {
  AgentMessage,
  ProviderAdapter,
  ToolCall,
  ToolDef,
  ToolResult,
  Usage,
} from '../providers'

/** Hard limits for one run. A confused or runaway model stops at the first one it hits. */
export interface RunBudget {
  maxSteps: number
  maxMs: number
  /** Input plus output tokens, summed over every model call in the run. */
  maxTokens: number
}

export const DEFAULT_BUDGET: RunBudget = {
  maxSteps: 12,
  maxMs: 120_000,
  maxTokens: 200_000,
}

export type StopReason = 'done' | 'steps' | 'time' | 'tokens' | 'aborted'

/** Wording for a run that stopped on a limit, or null when it ended normally. */
export function stopMessage(reason: StopReason, budget: RunBudget): string | null {
  switch (reason) {
    case 'steps':
      return `Stopped after ${budget.maxSteps} steps.`
    case 'time':
      return `Stopped after ${Math.round(budget.maxMs / 1000)} seconds.`
    case 'tokens':
      return `Stopped after using ${budget.maxTokens} tokens.`
    default:
      return null
  }
}

/** What the caller wants to see as the run goes (the chat log, a sub-run card). */
export interface LoopHooks {
  onText?(text: string): void
  onCall?(call: ToolCall): void
  onResult?(call: ToolCall, result: ToolResult): void
  /** The model asked for tools and the run will continue: start the next reply. */
  onNextStep?(): void
}

export interface LoopOptions {
  adapter: ProviderAdapter
  model: string
  system: string
  tools: ToolDef[]
  messages: AgentMessage[]
  exec(call: ToolCall): Promise<ToolResult>
  budget?: Partial<RunBudget>
  signal?: AbortSignal
  hooks?: LoopHooks
  /** Tokens used so far across a run and its sub-runs. Pass the parent's so one cap covers all. */
  spend?: { tokens: number }
}

export interface LoopResult {
  stop: StopReason
  /** Text of the last model reply, which for a finished run is its answer. */
  text: string
  usage: Usage
  steps: number
}

/**
 * The agent loop: call the model, run the tools it asks for, send the results back, and repeat
 * until it answers without tools or a budget runs out. `messages` is extended in place.
 */
export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const budget = { ...DEFAULT_BUDGET, ...opts.budget }
  const { adapter, hooks, messages } = opts
  if (!adapter.chat) throw new Error('This provider cannot call tools')

  const ctl = new AbortController()
  let timedOut = false
  const onAbort = () => ctl.abort()
  if (opts.signal?.aborted) ctl.abort()
  opts.signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, budget.maxMs)

  const usage: Usage = { inputTokens: 0, outputTokens: 0 }
  const spend = opts.spend ?? { tokens: 0 }
  let text = ''
  let steps = 0
  const finish = (stop: StopReason): LoopResult => ({ stop, text, usage, steps })
  const halted = (): StopReason => (timedOut ? 'time' : 'aborted')

  try {
    for (;;) {
      steps++
      const calls: ToolCall[] = []
      text = ''
      for await (const ev of adapter.chat(
        {
          model: opts.model,
          system: opts.system,
          messages,
          tools: opts.tools,
        },
        ctl.signal,
      )) {
        if (ev.type === 'text') {
          text += ev.text
          hooks?.onText?.(ev.text)
        } else if (ev.type === 'call') {
          calls.push(ev.call)
          hooks?.onCall?.(ev.call)
        } else {
          usage.inputTokens += ev.inputTokens
          usage.outputTokens += ev.outputTokens
          spend.tokens += ev.inputTokens + ev.outputTokens
        }
      }
      if (!calls.length) return finish('done')
      const results: ToolResult[] = []
      for (const call of calls) {
        if (ctl.signal.aborted) return finish(halted())
        const result = await opts.exec(call)
        results.push(result)
        hooks?.onResult?.(call, result)
      }
      if (ctl.signal.aborted) return finish(halted())
      if (steps >= budget.maxSteps) return finish('steps')
      if (spend.tokens >= budget.maxTokens) {
        return finish('tokens')
      }
      messages.push(
        { role: 'assistant', content: text, calls },
        { role: 'tool', results },
      )
      hooks?.onNextStep?.()
    }
  } catch (e) {
    // A timeout aborts the request in flight; that is a stop, not a failure.
    if (timedOut) return finish('time')
    throw e
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
