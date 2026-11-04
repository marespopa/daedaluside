import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { activeBufferAtom } from '../state/editorAtoms'
import { activePathAtom, openBuffersAtom } from '../state/workspaceAtoms'
import { IconButton } from '../ui'
import { MOD_KEY_LABEL } from '../lib/platform'
import { useController } from './useWorkspace'

/** Header action: immediately saves the active file. */
export default function SaveButton() {
  const controller = useController()
  const [saving, setSaving] = useState(false)
  const buffer = useAtomValue(activeBufferAtom)
  const activePath = useAtomValue(activePathAtom)
  const saveError = useAtomValue(openBuffersAtom).some(
    (openBuffer) => openBuffer.path === activePath && openBuffer.saveError,
  )
  const handleSave = async () => {
    setSaving(true)
    try {
      await controller.saveActive()
    } finally {
      setSaving(false)
    }
  }

  // Autosave covers the idle case, so the button only appears when it has something to do.
  if (!activePath || (!buffer.dirty && !saving && !saveError)) return null

  return (
    <IconButton
      label={saving ? 'Saving' : saveError ? 'Save failed' : 'Save'}
      title={
        saving
          ? 'Saving…'
          : saveError
            ? `Save failed — retry (${MOD_KEY_LABEL}+S)`
            : `Save (${MOD_KEY_LABEL}+S)`
      }
      icon={saving ? undefined : 'save'}
      disabled={!activePath || !buffer.dirty || saving}
      className={
        saveError && !saving ? 'text-diff-remove-fg hover:bg-diff-remove' : undefined
      }
      onClick={() => void handleSave()}
    >
      {saving && (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
    </IconButton>
  )
}
