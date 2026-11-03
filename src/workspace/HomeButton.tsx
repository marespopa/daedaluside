import { useAtomValue } from 'jotai'
import { activePathAtom } from '../state/workspaceAtoms'
import { Icon } from '../ui'
import { useController } from './useWorkspace'

/**
 * Header action: goes to the blank page. Open tabs stay open. Looks like the active tab
 * while the blank page is showing, and like an inactive tab otherwise.
 */
export default function HomeButton() {
  const controller = useController()
  const onHome = useAtomValue(activePathAtom) === null
  return (
    <button
      type="button"
      aria-label="Home"
      aria-current={onHome ? 'page' : undefined}
      title="Home"
      onClick={() => controller.showHome()}
      className={[
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-accent',
        onHome ? 'bg-surface font-medium text-text' : 'text-muted hover:bg-surface/60',
      ].join(' ')}
    >
      <Icon name="home" className="size-3.5" />
    </button>
  )
}
