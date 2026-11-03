import type { SessionSnapshot } from '../state/workspaceAtoms'
import { basename } from './path'

/**
 * The last session's tree, shown muted while storage starts. Same row height and
 * indent as the live tree, so the list does not jump when it is replaced.
 */
export default function TreeSkeleton({ entries }: { entries: SessionSnapshot['tree'] }) {
  return (
    <ul aria-hidden="true" className="motion-safe:animate-pulse">
      {entries.map((e) => {
        const depth = e.path.split('/').length - 1
        return (
          <li
            key={e.path}
            style={{ paddingLeft: depth * 12 + 8 }}
            className="truncate py-0.5 pr-2 font-mono text-xs text-muted"
          >
            {e.kind === 'dir' ? '▸ ' : ''}
            {basename(e.path)}
          </li>
        )
      })}
    </ul>
  )
}
