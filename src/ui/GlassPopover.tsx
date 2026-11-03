import type { HTMLAttributes, Ref } from 'react'

/** Floating surface. `.glass` blurs where supported and is opaque otherwise. */
export function GlassPopover({
  className = '',
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> | undefined }) {
  return (
    <div
      ref={ref}
      className={`glass rounded-xl border border-line text-text shadow-lg ${className}`}
      {...props}
    />
  )
}
