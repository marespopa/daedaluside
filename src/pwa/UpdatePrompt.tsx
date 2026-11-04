import { useAtom } from 'jotai'
import { Button } from '../ui'
import { pendingUpdateAtom } from './updateAtom'

export default function UpdatePrompt() {
  const [update, setUpdate] = useAtom(pendingUpdateAtom)
  if (!update) return null
  return (
    <div
      role="status"
      className="glass fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-line px-3 py-2 font-sans text-sm shadow-lg"
    >
      <span className="min-w-0 break-words">
        {update.message} Reloading discards unsaved changes.
      </span>
      <Button size="sm" variant="primary" onClick={update.apply}>
        Reload
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setUpdate(null)}>
        Later
      </Button>
    </div>
  )
}
