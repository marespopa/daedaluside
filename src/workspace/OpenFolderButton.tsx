import { Button } from '../ui'
import { useFolderPicker } from './useFolderPicker'

/** Header action: opens a local folder as a workspace. */
export default function OpenFolderButton() {
  const { pick, input } = useFolderPicker()
  return (
    <>
      <Button variant="secondary" size="sm" icon="folder" onClick={() => void pick()}>
        Open folder
      </Button>
      {input}
    </>
  )
}
