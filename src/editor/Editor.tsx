import { useAtomValue, useStore } from 'jotai'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { branchReviewAtom, branchTabActiveAtom } from '../state/branchReviewAtoms'
import { activeImageAtom, editorWidthAtom, vimEnabledAtom } from '../state/editorAtoms'
import { reviewOpenAtom } from '../state/gitAtoms'
import {
  activePathAtom,
  snapshotAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import WorkspaceOpener from '../workspace/WorkspaceOpener'
import { useController } from '../workspace/useWorkspace'
import { createEditor } from './createEditor'
import EditorSkeleton from './EditorSkeleton'

// Rarely-open views load on first use, keeping them out of the startup chunk.
const DiffReview = lazy(() => import('../review/DiffReview'))
const BranchReview = lazy(() => import('../review/branch/BranchReview'))
const ImageViewer = lazy(() => import('./ImageViewer'))

export default function Editor() {
  const host = useRef<HTMLDivElement>(null)
  const controller = useController()
  const store = useStore()
  const activePath = useAtomValue(activePathAtom)
  const status = useAtomValue(workspaceStatusAtom)
  const snapshot = useAtomValue(snapshotAtom)
  const width = useAtomValue(editorWidthAtom)
  const reviewOpen = useAtomValue(reviewOpenAtom)
  const branchLoaded = useAtomValue(branchReviewAtom) !== null
  const branchTabActive = useAtomValue(branchTabActiveAtom)
  const branchOpen = branchLoaded && branchTabActive
  const image = useAtomValue(activeImageAtom)
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
      <div ref={host} className="h-full" data-testid="editor" />
      <Suspense fallback={reviewOpen ? <EditorSkeleton /> : null}>
        {image && <ImageViewer />}
        {reviewOpen && <DiffReview />}
        {branchOpen && <BranchReview />}
      </Suspense>
      {restoring && <EditorSkeleton />}
      {/* Not while storage is starting: the workspace is about to open a file. */}
      {activePath === null && status.state !== 'loading' && <WorkspaceOpener />}
    </div>
  )
}
