import { useEffect, useRef } from 'react'

interface Props {
  label: string
  initial?: string
  onCommit: (value: string) => void
  onCancel: () => void
  className?: string
}

/** Inline text field: Enter commits, Escape or blur cancels. */
export default function NameInput({
  label,
  initial = '',
  onCommit,
  onCancel,
  className = '',
}: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // Select the base name, not the extension.
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])

  const finish = (commit: boolean) => {
    if (finished.current) return
    finished.current = true
    const v = ref.current?.value.trim() ?? ''
    if (commit && v) onCommit(v)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      aria-label={label}
      defaultValue={initial}
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(false)}
      className={`min-w-0 flex-1 rounded border border-accent bg-canvas px-1.5 py-0.5 font-mono text-xs text-text outline-none ${className}`}
    />
  )
}
