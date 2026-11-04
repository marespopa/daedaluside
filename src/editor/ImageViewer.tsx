import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { activeImageAtom } from '../state/editorAtoms'

/**
 * Read-only image display. The bytes become a blob URL with a MIME type the app chose
 * (see workspace/image.ts) and are shown only through `<img>`: scripts and external
 * loads in an SVG do not run there. Never inline an SVG or open the URL top-level.
 */
export default function ImageViewer() {
  const image = useAtomValue(activeImageAtom)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!image) return
    const u = URL.createObjectURL(
      new Blob([image.bytes as BlobPart], { type: image.mime }),
    )
    // A blob URL is an external resource owned by this effect, so state follows it here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      setUrl(null)
    }
  }, [image])

  if (!image || !url) return null
  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-auto bg-canvas p-4"
      data-testid="image-viewer"
    >
      <img
        src={url}
        alt={image.path}
        referrerPolicy="no-referrer"
        draggable={false}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}
