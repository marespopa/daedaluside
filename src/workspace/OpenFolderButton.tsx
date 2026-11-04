import { Button } from '../ui'
import { useFolderPicker } from './useFolderPicker'

/** Header action: opens a local folder as a workspace. */
export default function OpenFolderButton() {
  const { pick } = useFolderPicker()
  return (
    <Button variant="ghost" size="sm" icon="folder" onClick={() => void pick()}>
      Open folder
    </Button>
  )
}
