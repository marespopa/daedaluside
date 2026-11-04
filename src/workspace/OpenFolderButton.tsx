import { useSetAtom } from 'jotai'
import { noticeAtom } from '../state/workspaceAtoms'
import { Button } from '../ui'
import { useFolderPicker } from './useFolderPicker'

/** Header action: opens a local folder as a workspace. */
export default function OpenFolderButton() {
  const { pick } = useFolderPicker()
  const setNotice = useSetAtom(noticeAtom)
  const onClick = async () => {
    try {
      await pick()
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <Button variant="ghost" size="sm" icon="folder" onClick={() => void onClick()}>
      Open folder
    </Button>
  )
}
