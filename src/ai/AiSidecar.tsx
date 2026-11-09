import { useSetAtom, useStore } from 'jotai'
import { sidecarOpenAtom } from '../state/companionAtoms'
import { IconButton } from '../ui'
import { focusEditor, useController } from '../workspace/useWorkspace'
import CompanionChat from './CompanionChat'

/**
 * Chat beside the editor, sharing the thread with the AI Companion tab. On a narrow
 * screen it overlays the editor instead of squeezing it.
 */
export default function AiSidecar() {
  const store = useStore()
  const controller = useController()
  const setOpen = useSetAtom(sidecarOpenAtom)
  const close = () => {
    setOpen(false)
    focusEditor(store)
  }
  return (
    <aside
      aria-label="AI chat"
      className="anim-fade glass flex w-80 shrink-0 flex-col border-l border-line font-sans text-sm max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:w-[min(100vw,22rem)]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        }
      }}
    >
      <div className="flex h-header shrink-0 items-center justify-between px-3">
        <h2 className="font-medium">AI chat</h2>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Open in AI Companion tab"
            icon="expand-all"
            onClick={() => {
              setOpen(false)
              controller.openCompanion('chat')
            }}
          />
          <IconButton label="Close AI chat" icon="x" onClick={close} />
        </div>
      </div>
      <CompanionChat autoFocus onConfigure={() => controller.openCompanion('config')} />
    </aside>
  )
}
