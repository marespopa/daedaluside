import { useRef } from 'react'
import type { LinkedFolder } from './diskMirror'
import { useController } from './useWorkspace'

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: {
    mode: 'readwrite'
  }) => Promise<FileSystemDirectoryHandle>
}

/**
 * Opens a local folder and imports it as a new workspace, linked for write-back. Uses the
 * File System Access API when available, otherwise `<input webkitdirectory>` (no link).
 *
 * Render `input` once wherever the picker is used; `pick` must run from a user gesture.
 */
export function useFolderPicker() {
  const controller = useController()
  const fallbackInput = useRef<HTMLInputElement>(null)

  const pick = async () => {
    const pickerWindow = window as DirectoryPickerWindow
    if (!pickerWindow.showDirectoryPicker) {
      fallbackInput.current?.click()
      return
    }
    try {
      // readwrite: the picked folder is linked, so app changes are written back to it.
      const folder = (await pickerWindow.showDirectoryPicker({
        mode: 'readwrite',
      })) as LinkedFolder
      await controller.importFolderHandle(folder)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      fallbackInput.current?.click()
    }
  }

  const input = (
    <input
      ref={fallbackInput}
      type="file"
      multiple
      hidden
      aria-label="Folder to open"
      {...({ webkitdirectory: '' } as object)}
      onChange={(event) => {
        const files = [...(event.target.files ?? [])]
        event.target.value = ''
        if (files.length) void controller.importFolderFiles(files)
      }}
    />
  )

  return { pick, input }
}
