import { isAbort } from './controller'
import type { LinkedFile } from './types'
import { useController } from './useWorkspace'

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemFileHandle[]>
}

/**
 * Opens one picked file as its own single-file workspace. Uses the File System
 * Access API (`showOpenFilePicker`); unlike the folder picker it takes one file.
 *
 * `pick` must run from a user gesture.
 */
export function useFilePicker() {
  const controller = useController()

  const pick = async () => {
    const pickerWindow = window as FilePickerWindow
    if (!pickerWindow.showOpenFilePicker) {
      throw new Error('Your browser does not support opening files')
    }
    const [file] = (await pickerWindow
      .showOpenFilePicker({ mode: 'readwrite' })
      .catch((e: unknown) => {
        // Dismissing the picker is not an error: cancel silently.
        if (isAbort(e)) return []
        throw e
      })) as FileSystemFileHandle[]
    if (file) await controller.importFileHandle(file as LinkedFile)
  }

  return { pick }
}
