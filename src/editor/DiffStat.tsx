import { useAtomValue } from 'jotai'
import { hunkStats } from '../review/diff'
import { fileDiffMapAtom } from '../state/gitAtoms'
import { activePathAtom } from '../state/workspaceAtoms'

/** `+14 -3 • 3 hunks` for the open file against HEAD, as a low-contrast footnote. Hidden when it matches HEAD. */
export default function DiffStat() {
  const path = useAtomValue(activePathAtom)
  const hunks = useAtomValue(fileDiffMapAtom)
  const list = path === null ? undefined : hunks.get(path)
  if (!list || list.length === 0) return null
  const { added, removed, hunks: n } = hunkStats(list)
  return (
    <div
      role="status"
      aria-label="Changes against HEAD"
      className="shrink-0 font-mono text-xs text-muted/70"
    >
      +{added} -{removed} &bull; {n} {n === 1 ? 'hunk' : 'hunks'}
    </div>
  )
}
