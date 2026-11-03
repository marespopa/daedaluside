import { useAtomValue } from 'jotai'
import { importStatusAtom } from '../state/workspaceAtoms'
import { Button } from '../ui'
import { useFolderPicker } from './useFolderPicker'

/** Header action: opens a local folder as a workspace. */
export default function OpenFolderButton() {
  const { pick, input } = useFolderPicker()
  const importing = useAtomValue(importStatusAtom) !== null
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon="folder"
        disabled={importing}
        onClick={() => void pick()}
      >
        Open folder
      </Button>
      {input}
    </>
  )
}
