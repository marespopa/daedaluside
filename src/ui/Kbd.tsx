import type { HTMLAttributes } from 'react'

export function Kbd({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={`rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-muted ${className}`}
      {...props}
    />
  )
}
