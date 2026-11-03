import type { InputHTMLAttributes, Ref } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * The one text input style for the app. Feature code uses this instead of styling its
 * own `<input>`, so search fields and name fields look the same.
 *
 * - `field`: a soft filled box, for search fields in panels.
 * - `bare`: no box, for a search that is the whole surface (the command palette).
 * - `inline`: a ringed field for editing a name in place.
 */
export type InputVariant = 'field' | 'bare' | 'inline'
export type InputSize = 'xs' | 'sm' | 'lg'

const frames: Record<InputVariant, string> = {
  field:
    'bg-surface text-muted hover:bg-surface/80 focus-within:bg-canvas focus-within:text-text focus-within:ring-1 focus-within:ring-accent/50',
  bare: 'text-muted focus-within:text-text',
  inline: 'bg-canvas text-text ring-1 ring-accent/60 focus-within:ring-accent',
}

const sizes: Record<InputSize, string> = {
  xs: 'h-6 gap-1.5 px-1.5',
  sm: 'h-7 gap-2 px-2',
  lg: 'h-12 gap-3 px-4',
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  variant?: InputVariant
  size?: InputSize
  /** Leading icon, shown in the muted text colour. */
  icon?: IconName | undefined
  /** Applies to the frame around the field, e.g. `w-full`. */
  className?: string
  ref?: Ref<HTMLInputElement> | undefined
}

/**
 * Text field. The whole frame is a label, so a click anywhere in it focuses the field.
 * `ref` reaches the `<input>` itself.
 */
export function Input({
  variant = 'field',
  size = 'sm',
  icon,
  className = '',
  ref,
  ...rest
}: InputProps) {
  return (
    <label
      className={`flex min-w-0 items-center rounded-md text-sm transition-colors duration-150 ease-out ${frames[variant]} ${sizes[size]} ${className}`}
    >
      {icon && <Icon name={icon} className="size-3.5 shrink-0" />}
      <input
        ref={ref}
        spellCheck={false}
        autoComplete="off"
        {...rest}
        className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted"
      />
    </label>
  )
}
