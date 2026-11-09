import type { ChatMessage, ProviderAdapter } from '../providers'
import { ProviderError } from '../providers'
import type { Route, Stage } from '../router/router'
import { referencedPaths } from './context'
import { parsePatches, resolvePatches } from './patches'
import { EXECUTE_SYSTEM, PLAN_SYSTEM, executePrompt, planPrompt } from './prompts'
import { saveRun as defaultSaveRun } from './runs'
import type { Run } from './runs'
import type { FilePatch, Phase, WorkflowState } from './types'

export interface WorkflowDeps {
  resolveStage(stage: Stage): Promise<{ adapter: ProviderAdapter; route: Route }>
  /** Current file text, or null when the file does not exist. */
  readFile(path: string): Promise<string | null>
  saveRun?(run: Run): Promise<void>
  now?(): number
  newId?(): string
}

const IDLE: WorkflowState = {
  phase: 'idle',
  task: '',
  plan: '',
  patches: [],
  error: null,
}
const MAX_REFERENCED_CHARS = 40_000

const modelLabel = (r: Route) => `${r.provider}/${r.model}`

/**
 * Idle, Planning, PlanReview, Executing, DiffReview, Applying, Completed (ARCHITECTURE.md).
 * Methods do not throw on provider or patch failures: the state moves to `failed` or `cancelled`.
 * Calling a method in the wrong phase is a programming error and throws.
 */
export class Workflow {
  #state: WorkflowState = IDLE
  #listeners = new Set<() => void>()
  #abort: AbortController | null = null
  #messages: ChatMessage[] = []
  #run: Run | null = null
  #executeRoute: Route | null = null

  readonly deps: WorkflowDeps

  constructor(deps: WorkflowDeps) {
    this.deps = deps
  }

  get state(): WorkflowState {
    return this.#state
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  /** Planning: `context` comes from `buildContext`. Streams the plan through `onChunk`. */
  async plan(
    task: string,
    context: string,
    onChunk?: (text: string) => void,
  ): Promise<void> {
    this.#expect('idle', 'cancelled', 'failed', 'completed')
    const now = (this.deps.now ?? Date.now)()
    this.#run = null
    this.#messages = [{ role: 'user', content: planPrompt(context, task) }]
    this.#set({ phase: 'planning', task, plan: '', patches: [], error: null })
    await this.#runPlan(onChunk, now)
  }

  /** Back to Planning with feedback on the current plan. */
  async revise(feedback: string, onChunk?: (text: string) => void): Promise<void> {
    this.#expect('plan-review')
    this.#messages.push({ role: 'assistant', content: this.#state.plan })
    this.#messages.push({ role: 'user', content: feedback })
    this.#set({ phase: 'planning', plan: '' })
    await this.#runPlan(onChunk, (this.deps.now ?? Date.now)())
  }

  /**
   * Executing: `plan` is the plan as the user approved or edited it. Also used to re-run from diff
   * review, or to retry after a failure.
   */
  async execute(
    plan: string,
    context: string,
    onChunk?: (text: string) => void,
  ): Promise<void> {
    this.#expect('plan-review', 'diff-review', 'failed', 'cancelled')
    if (!plan.trim()) throw new Error('Cannot execute an empty plan')
    this.#set({ phase: 'executing', plan, patches: [], error: null })
    const signal = this.#begin()
    try {
      const { adapter, route } = await this.deps.resolveStage('execute')
      this.#executeRoute = route
      const files = await this.#loadReferenced(plan)
      const text = await this.#collect(
        adapter.stream(
          {
            model: route.model,
            system: EXECUTE_SYSTEM,
            messages: [{ role: 'user', content: executePrompt(context, plan, files) }],
            temperature: 0,
          },
          signal,
        ),
        onChunk,
      )
      const patches = await resolvePatches(parsePatches(text), this.deps.readFile)
      this.#set({ phase: 'diff-review', patches })
    } catch (e) {
      this.#fail(e)
    }
    await this.#persist()
  }

  /** Applying: the caller may pass the hunks the user kept; they must be a subset of the proposed patches. */
  beginApply(accepted: FilePatch[] = this.#state.patches): void {
    this.#expect('diff-review')
    const known = new Set(this.#state.patches.map((p) => p.path))
    if (accepted.some((p) => !known.has(p.path)))
      throw new Error('Patch was not proposed by the model')
    this.#set({ phase: 'applying', patches: accepted })
  }

  async complete(): Promise<void> {
    this.#expect('applying')
    this.#set({ phase: 'completed' })
    await this.#persist()
  }

  /** Apply failed partway (for example a write error). */
  async failApply(message: string): Promise<void> {
    this.#expect('applying')
    this.#set({ phase: 'failed', error: message })
    await this.#persist()
  }

  /** Stops a running stream. The phase becomes `cancelled`. */
  cancel(): void {
    this.#abort?.abort()
  }

  reset(): void {
    this.#abort?.abort()
    this.#run = null
    this.#messages = []
    this.#set(IDLE)
  }

  async #runPlan(
    onChunk: ((text: string) => void) | undefined,
    now: number,
  ): Promise<void> {
    const signal = this.#begin()
    try {
      const { adapter, route } = await this.deps.resolveStage('plan')
      const plan = (
        await this.#collect(
          adapter.stream(
            { model: route.model, system: PLAN_SYSTEM, messages: this.#messages },
            signal,
          ),
          onChunk,
        )
      ).trim()
      if (!plan) throw new Error('The model returned an empty plan')
      this.#run ??= {
        id: (this.deps.newId ?? (() => crypto.randomUUID()))(),
        task: this.#state.task,
        plan: '',
        phase: 'planning',
        planModel: modelLabel(route),
        executeModel: '',
        files: [],
        error: null,
        createdAt: now,
        updatedAt: now,
      }
      this.#set({ phase: 'plan-review', plan })
    } catch (e) {
      this.#fail(e)
    }
    await this.#persist()
  }

  async #collect(
    stream: AsyncIterable<string>,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    let out = ''
    for await (const chunk of stream) {
      out += chunk
      onChunk?.(chunk)
    }
    return out
  }

  async #loadReferenced(plan: string) {
    const files: { path: string; content: string }[] = []
    let used = 0
    for (const path of referencedPaths(plan)) {
      let content: string | null = null
      try {
        content = await this.deps.readFile(path)
      } catch {
        /* unreadable or not a file: the model works from the plan alone */
      }
      if (content === null || used + content.length > MAX_REFERENCED_CHARS) continue
      used += content.length
      files.push({ path, content })
    }
    return files
  }

  #begin(): AbortSignal {
    this.#abort = new AbortController()
    return this.#abort.signal
  }

  #fail(e: unknown) {
    if (e instanceof ProviderError && e.kind === 'aborted') {
      this.#set({ phase: 'cancelled', error: null })
    } else {
      this.#set({
        phase: 'failed',
        error: e instanceof Error ? e.message : 'Something went wrong',
      })
    }
  }

  #expect(...phases: Phase[]) {
    if (!phases.includes(this.#state.phase)) {
      throw new Error(`Not allowed while ${this.#state.phase}`)
    }
  }

  #set(patch: Partial<WorkflowState>) {
    this.#state = { ...this.#state, ...patch }
    for (const fn of this.#listeners) fn()
  }

  async #persist(): Promise<void> {
    if (!this.#run) return
    const s = this.#state
    this.#run = {
      ...this.#run,
      plan: s.plan,
      phase: s.phase,
      executeModel: this.#executeRoute ? modelLabel(this.#executeRoute) : '',
      files: s.patches.map((p) => p.path),
      error: s.error,
      updatedAt: (this.deps.now ?? Date.now)(),
    }
    try {
      await (this.deps.saveRun ?? defaultSaveRun)(this.#run)
    } catch {
      /* history is best effort; it must never break the run */
    }
  }
}
