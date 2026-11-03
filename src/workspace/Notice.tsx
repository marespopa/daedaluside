import { useAtom } from 'jotai'
import { useEffect } from 'react'
import { noticeAtom } from '../state/workspaceAtoms'
import { IconButton } from '../ui'

export default function Notice() {
  const [notice, setNotice] = useAtom(noticeAtom)
  useEffect(() => {
    if (!notice || notice.kind === 'error') return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice, setNotice])
  if (!notice) return null
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className="glass fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-line px-3 py-2 font-sans text-sm shadow-lg"
    >
      <span className="min-w-0 break-words">{notice.text}</span>
      <IconButton label="Dismiss" icon="x" size="sm" onClick={() => setNotice(null)} />
    </div>
  )
}
