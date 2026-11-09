import { useAtomValue, useStore } from 'jotai'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { branchReviewAtom, branchTabActiveAtom } from '../state/branchReviewAtoms'
import { companionOpenAtom } from '../state/companionAtoms'
import { activeImageAtom, editorWidthAtom, vimEnabledAtom } from '../state/editorAtoms'
import { reviewOpenAtom } from '../state/gitAtoms'
import {
  activePathAtom,
  openingPathAtom,
  snapshotAtom,
  workspaceStatusAtom,
} from '../state/workspaceAtoms'
import WorkspaceOpener from '../workspace/WorkspaceOpener'
import { useController } from '../workspace/useWorkspace'
import { createEditor } from './createEditor'
import EditorSkeleton from './EditorSkeleton'
import { pathLinks } from './pathLinks'
import SymbolOverlays from './SymbolOverlays'
import { SymbolBus } from './symbolBus'
import { symbolTriggers } from './contextMenu'

// Rarely-open views load on first use, keeping them out of the startup chunk.
const DiffReview = lazy(() => import('../review/DiffReview'))
const BranchReview = lazy(() => import('../review/branch/BranchReview'))
const AiCompanion = lazy(() => import('../ai/AiCompanion'))
const ImageViewer = lazy(() => import('./ImageViewer'))

/** True once `on` has held for `ms`, so fast opens do not flash a placeholder. */
function useDelayed(on: boolean, ms: number) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) return
    const t = setTimeout(() => setLate(true), ms)
    return () => {
      clearTimeout(t)
      setLate(false)
    }
  }, [on, ms])
  return on && late
}

export default function Editor() {
  const host = useRef<HTMLDivElement>(null)
  const [bus] = useState(() => new SymbolBus())
  const controller = useController()
  const store = useStore()
  const activePath = useAtomValue(activePathAtom)
  const status = useAtomValue(workspaceStatusAtom)
  const snapshot = useAtomValue(snapshotAtom)
  const width = useAtomValue(editorWidthAtom)
  const opening = useDelayed(useAtomValue(openingPathAtom) !== null, 120)
  const reviewOpen = useAtomValue(reviewOpenAtom)
  const branchLoaded = useAtomValue(branchReviewAtom) !== null
  const branchTabActive = useAtomValue(branchTabActiveAtom)
  const branchOpen = branchLoaded && branchTabActive
  const companionExists = useAtomValue(companionOpenAtom)
  const image = useAtomValue(activeImageAtom)
  // Last session's file is being restored: show its place, not an empty editor.
  const restoring = status.state === 'loading' && snapshot?.activeFile != null

  // Replay a short fade each time another file comes into view.
  useEffect(() => {
    const el = host.current
    if (!el || activePath === null) return
    el.classList.remove('anim-fade')
    void el.offsetWidth // restart the animation
    el.classList.add('anim-fade')
  }, [activePath])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const handle = createEditor({
      parent: el,
      // Only metadata goes to Jotai; the controller owns buffer text and states.
      onUpdate: (u) => controller.onEditorUpdate(u),
      extensions: [
        pathLinks({
          enabled: () => store.get(activePathAtom) !== null,
          onOpen: (ref) => void controller.openReference(ref),
          exists: (ref) => controller.mayOpenReference(ref),
        }),
        symbolTriggers({
          enabled: () => store.get(activePathAtom) !== null,
          onMenu: (at) => bus.menu(at),
          onAction: (a) => bus.action(a),
        }),
      ],
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
  }, [controller, store, bus])

  return (
    <div className="relative h-full" data-editor-width={width}>
      <div ref={host} className="h-full" data-testid="editor" />
      <SymbolOverlays bus={bus} />
      <Suspense fallback={reviewOpen ? <EditorSkeleton /> : null}>
        {image && <ImageViewer />}
        {reviewOpen && <DiffReview />}
        {branchOpen && <BranchReview />}
        {companionExists && <AiCompanion />}
      </Suspense>
      {(restoring || opening) && <EditorSkeleton />}
      {/* Not while storage is starting: the workspace is about to open a file. */}
      {activePath === null && status.state !== 'loading' && <WorkspaceOpener />}
    </div>
  )
}
