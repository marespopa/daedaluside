import { useAtomValue } from 'jotai'
import { vimEnabledAtom, vimStatusAtom } from '../state/editorAtoms'
import { activePathAtom } from '../state/workspaceAtoms'

/** The Vim mode as a footnote under the editor. Shown only while Vim mode is on and a file is open. */
export default function VimStatus() {
  const enabled = useAtomValue(vimEnabledAtom)
  const status = useAtomValue(vimStatusAtom)
  const activePath = useAtomValue(activePathAtom)
  if (!enabled || !status || status.prompt || activePath === null) return null
  return (
    <div role="status" className="shrink-0 px-3 pb-1 font-mono text-xs text-muted">
      {status.label}
    </div>
  )
}
