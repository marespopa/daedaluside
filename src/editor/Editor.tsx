import { useAtomValue, useStore } from 'jotai'
import { useEffect, useRef } from 'react'
import { editorWidthAtom, vimEnabledAtom } from '../state/editorAtoms'
import {
  activePathAtom,
  importStatusAtom,
  snapshotAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import OpeningFolder from '../workspace/OpeningFolder'
import WorkspaceOpener from '../workspace/WorkspaceOpener'
import { useController } from '../workspace/useWorkspace'
import { createEditor } from './createEditor'
import EditorSkeleton from './EditorSkeleton'

export default function Editor() {
  const host = useRef<HTMLDivElement>(null)
  const controller = useController()
  const store = useStore()
  const activePath = useAtomValue(activePathAtom)
  const status = useAtomValue(workspaceStatusAtom)
  const snapshot = useAtomValue(snapshotAtom)
  const importing = useAtomValue(importStatusAtom)
  const width = useAtomValue(editorWidthAtom)
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
    handle.setVim(store.get(vimEnabledAtom))
    controller.attach(handle)
    const unsubscribe = store.sub(vimEnabledAtom, () =>
      handle.setVim(store.get(vimEnabledAtom)),
    )
    return () => {
      unsubscribe()
      controller.detach()
      handle.destroy()
    }
  }, [controller, store])

  return (
    <div className="relative h-full" data-editor-width={width}>
      {/* Inert while importing: the scratch file must not take keystrokes under the overlay. */}
      <div
        ref={host}
        inert={importing !== null}
        className="h-full"
        data-testid="editor"
      />
      {restoring && <EditorSkeleton />}
      {importing ? (
        <OpeningFolder status={importing} />
      ) : (
        /* Not while storage is starting: the workspace is about to open a file. */
        activePath === null && status.state !== 'loading' && <WorkspaceOpener />
      )}
    </div>
  )
}
