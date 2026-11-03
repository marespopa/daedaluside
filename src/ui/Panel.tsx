import type { HTMLAttributes } from 'react'

export function Panel({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface text-text ${className}`}
      {...props}
    />
  )
}
