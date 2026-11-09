import type { Ref, TextareaHTMLAttributes } from 'react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement> | undefined
}

/** Multi-line field in the same bordered style as `Input` variant `outlined`. */
export function Textarea({ className = '', ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      {...rest}
      className={`rounded-md border border-muted bg-canvas px-2 py-1.5 text-sm text-text outline-none placeholder:text-muted hover:bg-surface focus:border-accent focus:ring-1 focus:ring-accent ${className}`}
    />
  )
}
