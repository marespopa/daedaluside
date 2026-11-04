import { isAbort } from './controller'
import type { LinkedFolder } from './types'
import { useController } from './useWorkspace'

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: {
    mode: 'readwrite'
  }) => Promise<FileSystemDirectoryHandle>
}

/**
 * Opens a local folder as the current workspace. Uses the File System Access API
 * (`showDirectoryPicker`); the picked folder is the source of truth for the workspace.
 *
 * `pick` must run from a user gesture.
 */
export function useFolderPicker() {
  const controller = useController()

  const pick = async () => {
    const pickerWindow = window as DirectoryPickerWindow
    if (!pickerWindow.showDirectoryPicker) {
      throw new Error('Your browser does not support opening folders')
    }
    const folder = (await pickerWindow
      .showDirectoryPicker({
        mode: 'readwrite',
      })
      .catch((e: unknown) => {
        // Dismissing the picker is not an error: cancel silently.
        if (isAbort(e)) return null
        throw e
      })) as LinkedFolder | null
    if (folder) await controller.importFolderHandle(folder)
  }

  return { pick }
}
