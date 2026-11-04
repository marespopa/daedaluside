import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { linkedFolderAtom, reconnectPromptAtom } from '../state/workspaceAtoms'
import { Button } from '../ui'
import { focusEditor, useController } from './useWorkspace'

/**
 * Asks to reconnect a linked folder the browser no longer lets the app write to. The
 * browser only shows its permission prompt from a click, so Reconnect is a button.
 * "Later" hides the dialog until the next open or a failed write.
 */
export default function ReconnectDialog() {
  const link = useAtomValue(linkedFolderAtom)
  const prompt = useAtomValue(reconnectPromptAtom)
  const setPrompt = useSetAtom(reconnectPromptAtom)
  const controller = useController()
  const store = useStore()
  if (!link?.paused || !prompt) return null

  const later = () => {
    setPrompt(false)
    focusEditor(store)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/60 px-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && later()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconnect-title"
        className="glass w-full max-w-md rounded-xl border border-line p-5 font-sans text-sm shadow-lg"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            later()
          }
        }}
      >
        <h2 id="reconnect-title" className="text-sm font-medium text-text">
          Reconnect {link.name}?
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          The browser has not granted write access to this folder. Reconnect to allow
          editing; the files stay available for reading.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={later}>
            Later
          </Button>
          <Button
            variant="primary"
            size="sm"
            autoFocus
            onClick={() => void controller.reconnectFolder()}
          >
            Reconnect
          </Button>
        </div>
      </div>
    </div>
  )
}
