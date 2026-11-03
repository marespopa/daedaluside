import type { HTMLAttributes } from 'react'

/** Floating surface. `.glass` blurs where supported and is opaque otherwise. */
export function GlassPopover({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`glass rounded-xl border border-line text-text shadow-lg ${className}`}
      {...props}
    />
  )
}
