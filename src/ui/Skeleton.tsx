import type { CSSProperties } from 'react'

/**
 * Placeholder block for content that is still loading. Pulses only when the user
 * allows motion (`motion-safe`), and is hidden from assistive technology.
 */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded bg-muted/25 motion-safe:animate-pulse ${className}`}
      style={style}
    />
  )
}
