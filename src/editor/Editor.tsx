import { useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import {
  activePathAtom,
  snapshotAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import WorkspaceOpener from '../workspace/WorkspaceOpener'
import { useController } from '../workspace/useWorkspace'
import { createEditor } from './createEditor'
import EditorSkeleton from './EditorSkeleton'

export default function Editor() {
  const host = useRef<HTMLDivElement>(null)
  const controller = useController()
  const activePath = useAtomValue(activePathAtom)
  const status = useAtomValue(workspaceStatusAtom)
  const snapshot = useAtomValue(snapshotAtom)
  // Last session's file is being restored: show its place, not an empty editor.
  const restoring = status.state === 'loading' && snapshot?.activeFile != null

  useEffect(() => {
    const el = host.current
    if (!el) return
    const handle = createEditor({
      parent: el,
      // Only metadata goes to Jotai; the controller owns buffer text and states.
      onUpdate: (u) => controller.onEditorUpdate(u),
    })
    controller.attach(handle)
    return () => {
      controller.detach()
      handle.destroy()
    }
  }, [controller])

  return (
    <div className="relative h-full">
      <div ref={host} className="h-full" data-testid="editor" />
      {restoring && <EditorSkeleton />}
      {/* Not while storage is starting: the workspace is about to open a file. */}
      {activePath === null && status.state !== 'loading' && <WorkspaceOpener />}
    </div>
  )
}
