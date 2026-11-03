import { useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { activeBufferAtom, editorHandleAtom, initialBuffer } from '../state/editorAtoms'
import { createEditor } from './createEditor'

export default function Editor() {
  const host = useRef<HTMLDivElement>(null)
  const setBuffer = useSetAtom(activeBufferAtom)
  const setHandle = useSetAtom(editorHandleAtom)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const handle = createEditor({
      parent: el,
      filename: initialBuffer.name,
      onUpdate: (u) => {
        if (!u.docChanged && !u.selectionSet) return
        const head = u.state.selection.main.head
        const line = u.state.doc.lineAt(head)
        // Only metadata goes to Jotai, never the document text.
        setBuffer((b) => ({
          ...b,
          dirty: b.dirty || u.docChanged,
          line: line.number,
          column: head - line.from + 1,
          length: u.state.doc.length,
        }))
      },
    })
    setHandle(handle)
    void handle
      .setLanguage(initialBuffer.name)
      .then((language) => setBuffer((b) => ({ ...b, language })))
    handle.view.focus()
    return () => {
      setHandle(null)
      handle.destroy()
    }
  }, [setBuffer, setHandle])

  return <div ref={host} className="h-full" data-testid="editor" />
}
