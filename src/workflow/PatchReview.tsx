import { useMemo, useState } from 'react'
import { splitLines } from '../review/diff'
import { Button } from '../ui'
import { acceptAll, patchHunks, selectPatches } from './select'
import type { FilePatch } from './types'

interface Props {
  patches: FilePatch[]
  /** Called with the patches left after the user's choices. Resolves when applying is done. */
  onApply(patches: FilePatch[]): Promise<unknown> | void
  onCancel(): void
}

/** Review of AI patches: every hunk starts accepted; the user can drop hunks or whole files. */
export default function PatchReview({ patches, onApply, onCancel }: Props) {
  const [choice, setChoice] = useState(() => acceptAll(patches))
  const [busy, setBusy] = useState(false)
  const hunks = useMemo(() => patches.map((p) => patchHunks(p)), [patches])

  const toggle = (path: string, i: number) =>
    setChoice((prev) => {
      const next = new Map(prev)
      const set = new Set(next.get(path))
      if (!set.delete(i)) set.add(i)
      next.set(path, set)
      return next
    })
  const toggleFile = (path: string, count: number) =>
    setChoice((prev) => {
      const next = new Map(prev)
      const all = (prev.get(path)?.size ?? 0) === count
      next.set(
        path,
        all ? new Set() : new Set(Array.from({ length: count }, (_, i) => i)),
      )
      return next
    })

  const chosen = hunks.reduce(
    (n, _hs, i) => n + (choice.get(patches[i]!.path)?.size ?? 0),
    0,
  )
  const total = hunks.reduce((n, hs) => n + hs.length, 0)

  const apply = async () => {
    setBusy(true)
    try {
      await onApply(selectPatches(patches, choice))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-canvas/60 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="patch-review-h"
        className="glass anim-pop flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-line p-4 font-sans text-sm shadow-lg"
      >
        <h2 id="patch-review-h" className="mb-3 text-base font-medium">
          Review changes ({chosen} of {total} hunks selected)
        </h2>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {patches.map((p, pi) => {
            const hs = hunks[pi]!
            const picked = choice.get(p.path) ?? new Set<number>()
            const baseLines = splitLines(p.base ?? '')
            const newLines = splitLines(p.content)
            return (
              <section key={p.path} aria-label={p.path}>
                <label className="flex items-center gap-2 font-mono text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={picked.size === hs.length}
                    disabled={busy}
                    onChange={() => toggleFile(p.path, hs.length)}
                    aria-label={`Select all changes in ${p.path}`}
                  />
                  {p.path}
                  {p.base === null && <span className="text-muted">(new file)</span>}
                </label>
                <ul className="mt-1 space-y-1">
                  {hs.map((h, i) => (
                    <li key={i} className="rounded border border-line p-1.5">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={picked.has(i)}
                          disabled={busy}
                          onChange={() => toggle(p.path, i)}
                          aria-label={`Hunk ${i + 1} of ${p.path}, line ${h.newRange.start + 1}`}
                          className="mt-1"
                        />
                        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs">
                          {baseLines
                            .slice(
                              h.baseRange.start,
                              h.baseRange.start + h.baseRange.count,
                            )
                            .map((l, k) => (
                              <div key={`r${k}`} className="text-diff-remove-fg">
                                {'- '}
                                {l}
                              </div>
                            ))}
                          {newLines
                            .slice(h.newRange.start, h.newRange.start + h.newRange.count)
                            .map((l, k) => (
                              <div key={`a${k}`} className="text-diff-add-fg">
                                {'+ '}
                                {l}
                              </div>
                            ))}
                        </pre>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || chosen === 0} onClick={apply}>
            {busy ? 'Applying…' : 'Apply selected'}
          </Button>
        </div>
      </div>
    </div>
  )
}
