import { useAtom, useStore } from 'jotai'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { aiOpenAtom } from '../state/aiAtoms'
import { activePathAtom, openBuffersAtom, treeAtom } from '../state/workspaceAtoms'
import { resolveStage } from '../router/router'
import { Button } from '../ui'
import { focusEditor, useController } from '../workspace/useWorkspace'
import { buildContext } from '../workflow/context'
import { Workflow } from '../workflow/pipeline'
import PatchReview from '../workflow/PatchReview'
import type { FilePatch } from '../workflow/types'

export default function AiPanel() {
  const [open, setOpen] = useAtom(aiOpenAtom)
  return open ? <Panel onClose={() => setOpen(false)} /> : null
}

const NEEDS_SETTINGS = /vault is locked|no api key|no vault/i

function Panel({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const controller = useController()
  const wf = useMemo(
    () =>
      new Workflow({
        resolveStage: (stage) => resolveStage(stage),
        readFile: (path) => controller.readForPreview(path),
      }),
    [controller],
  )
  const state = useSyncExternalStore(
    (fn) => wf.subscribe(fn),
    () => wf.state,
  )
  const [task, setTask] = useState('')
  const [feedback, setFeedback] = useState('')
  const [preparing, setPreparing] = useState(false)
  // The user's edits to the plan; null shows the model's text as written.
  const [edited, setEdited] = useState<string | null>(null)
  const plan = edited ?? state.plan
  const [streamed, setStreamed] = useState('')
  const context = useRef('')
  const taskBox = useRef<HTMLTextAreaElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    taskBox.current?.focus()
    return () => {
      wf.reset()
      focusEditor(store)
    }
  }, [wf, store])

  // A button that disappears when the phase changes takes focus with it; keep it in the dialog
  // so Escape still works.
  const phaseNow = state.phase
  useEffect(() => {
    const el = dialog.current
    if (el && !el.contains(document.activeElement)) el.focus()
  }, [phaseNow, preparing])

  const onChunk = (text: string) => setStreamed((s) => s + text)

  const makePlan = async () => {
    if (!task.trim()) return
    setStreamed('')
    setEdited(null)
    // Show "Planning…" in this frame; gathering the open files is quick but async.
    setPreparing(true)
    try {
      const paths = store.get(openBuffersAtom).map((b) => b.path)
      const files = (
        await Promise.all(
          paths.map(async (path) => ({
            path,
            content: await controller.readForPreview(path),
          })),
        )
      ).filter((f): f is { path: string; content: string } => f.content !== null)
      const rules = (await controller.readForPreview('AGENTS.md')) ?? undefined
      context.current = buildContext({
        activePath: store.get(activePathAtom),
        openFiles: files,
        treePaths: store
          .get(treeAtom)
          .filter((e) => e.kind === 'file')
          .map((e) => e.path),
        ...(rules ? { rules } : {}),
      })
    } finally {
      setPreparing(false)
    }
    await wf.plan(task.trim(), context.current, onChunk)
  }

  const apply = async (patches: FilePatch[]) => {
    wf.beginApply(patches)
    if (await controller.applyPatches(patches)) {
      await wf.complete()
      onClose()
    } else {
      await wf.failApply('The changes were not applied.')
    }
  }

  const { phase } = state
  if (phase === 'diff-review') {
    return (
      <PatchReview
        patches={state.patches}
        onApply={apply}
        onCancel={() => void wf.reset()}
      />
    )
  }

  const working =
    preparing || phase === 'planning' || phase === 'executing' || phase === 'applying'

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-canvas/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !working && onClose()}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="AI: Plan change"
        className="glass anim-pop flex max-h-full outline-none w-full max-w-2xl flex-col gap-3 rounded-xl border border-line p-5 font-sans text-sm shadow-lg"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          if (working) wf.cancel()
          else onClose()
        }}
      >
        <h2 className="text-base font-medium">AI: Plan change</h2>

        {!preparing &&
          (phase === 'idle' ||
            phase === 'cancelled' ||
            phase === 'failed' ||
            phase === 'completed') &&
          !state.plan && (
            <>
              <label htmlFor="ai-task">What should change?</label>
              <textarea
                id="ai-task"
                ref={taskBox}
                rows={4}
                value={task}
                onChange={(e) => setTask(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void makePlan()
                }}
                className="w-full resize-y rounded-md border border-muted bg-canvas p-2 text-text"
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  disabled={!task.trim()}
                  onClick={() => void makePlan()}
                >
                  Make plan
                </Button>
              </div>
            </>
          )}

        {working && (
          <>
            <p role="status">
              {phase === 'planning'
                ? 'Planning…'
                : phase === 'executing'
                  ? 'Writing edits…'
                  : 'Applying…'}
            </p>
            <pre className="max-h-64 overflow-auto rounded-md border border-line p-2 font-mono text-xs whitespace-pre-wrap">
              {streamed}
            </pre>
            <div className="flex justify-end">
              <Button onClick={() => wf.cancel()}>Cancel</Button>
            </div>
          </>
        )}

        {phase === 'plan-review' && (
          <>
            <label htmlFor="ai-plan">Plan (edit it before approving)</label>
            <textarea
              id="ai-plan"
              rows={10}
              value={plan}
              onChange={(e) => setEdited(e.currentTarget.value)}
              className="w-full resize-y rounded-md border border-muted bg-canvas p-2 font-mono text-xs text-text"
            />
            <div className="flex items-center gap-2">
              <label htmlFor="ai-feedback" className="sr-only">
                Feedback for a new plan
              </label>
              <input
                id="ai-feedback"
                value={feedback}
                placeholder="Feedback for a new plan"
                onChange={(e) => setFeedback(e.currentTarget.value)}
                className="min-w-0 flex-1 rounded-md border border-muted bg-canvas px-2 py-1 text-text"
              />
              <Button
                disabled={!feedback.trim()}
                onClick={() => {
                  setStreamed('')
                  setEdited(null)
                  const f = feedback.trim()
                  setFeedback('')
                  void wf.revise(f, onChunk)
                }}
              >
                Revise
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                variant="primary"
                disabled={!plan.trim()}
                onClick={() => {
                  setStreamed('')
                  void wf.execute(plan, context.current, onChunk)
                }}
              >
                Approve and write edits
              </Button>
            </div>
          </>
        )}

        {(phase === 'failed' || phase === 'cancelled') && (
          <div role="alert" className="space-y-2">
            <p className="text-diff-remove-fg">
              {phase === 'cancelled' ? 'Cancelled.' : `Error: ${state.error}`}
            </p>
            {phase === 'failed' && state.error && NEEDS_SETTINGS.test(state.error) && (
              <Button
                onClick={() => {
                  onClose()
                  controller.openCompanion('config')
                }}
              >
                Open AI Configure
              </Button>
            )}
            {state.plan && (
              <Button
                onClick={() => void wf.execute(state.plan, context.current, onChunk)}
              >
                Try the edits again
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
