import type { ButtonHTMLAttributes } from 'react'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string
}

export function IconButton({
  label,
  className = '',
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
