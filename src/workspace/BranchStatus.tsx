import { useAtomValue } from 'jotai'
import {
  branchPrefetchCountAtom,
  branchPrefetchReadyAtom,
  gitBranchAtom,
  gitRepoAtom,
} from '../state/gitAtoms'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useController } from './useWorkspace'

/**
 * One quiet line for the branch workflow: `⎇ main · 4 files changed`. The changed-files
 * text is the way into the review and is underlined, so it never relies on color alone.
 * It reads the branch first, then waits for the background review before offering the link.
 */
export default function BranchStatus({
  className = '',
  link = true,
}: {
  className?: string
  /** Show the changed-files link; the opener shows a button beside Settings instead. */
  link?: boolean
}) {
  const controller = useController()
  const branch = useAtomValue(gitBranchAtom)
  const isRepo = useAtomValue(gitRepoAtom)
  const ready = useAtomValue(branchPrefetchReadyAtom)
  const count = useAtomValue(branchPrefetchCountAtom)
  if (!branch && !isRepo) return null
  return (
    <p
      role="status"
      aria-live="polite"
      className={`anim-fade flex items-center gap-1.5 text-xs text-muted ${className}`}
    >
      <Icon name="git-branch" className="size-3" />
      <span className={branch ? 'text-text' : 'motion-safe:animate-pulse'}>
        {branch ?? '···'}
      </span>
      {branch && (
        <>
          <span aria-hidden>·</span>
          {!link ? (
            <span>
              {!ready
                ? 'Checking changes…'
                : count === 0
                  ? 'No changes'
                  : `${count ?? 'Some'} ${count === 1 ? 'file' : 'files'} changed`}
            </span>
          ) : !ready ? (
            <span className="motion-safe:animate-pulse">Checking changes…</span>
          ) : count === 0 ? (
            <span>No changes</span>
          ) : (
            <button
              type="button"
              onClick={() => void controller.openBranchReview()}
              aria-label={`Review branch changes on ${branch}`}
              className="anim-fade rounded-sm underline decoration-muted/60 underline-offset-4 transition-colors hover:text-text hover:decoration-text active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {count === null
                ? 'Review changes'
                : `${count} ${count === 1 ? 'file' : 'files'} changed`}
            </button>
          )}
        </>
      )}
    </p>
  )
}

/** Opens the branch review; renders nothing until the branch has changes to review. */
export function BranchReviewButton() {
  const controller = useController()
  const branch = useAtomValue(gitBranchAtom)
  const ready = useAtomValue(branchPrefetchReadyAtom)
  const count = useAtomValue(branchPrefetchCountAtom)
  if (!branch || !ready || count === 0) return null
  return (
    <Button
      size="sm"
      onClick={() => void controller.openBranchReview()}
      aria-label={`Review branch changes on ${branch}`}
    >
      Review Branch
    </Button>
  )
}
