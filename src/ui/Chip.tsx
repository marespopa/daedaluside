import type { HTMLAttributes } from 'react'

export function Chip({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={`glass inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 font-sans text-xs text-muted ${className}`}
      {...props}
    />
  )
}
