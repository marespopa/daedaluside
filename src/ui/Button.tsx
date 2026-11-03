import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * The one button style for the whole app. Feature code uses this (or IconButton)
 * instead of writing its own classes, so every control looks and behaves the same.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md'

const base =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-sans font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-text text-canvas hover:opacity-90',
  secondary: 'border border-line bg-canvas text-text hover:bg-surface',
  ghost: 'text-muted hover:bg-surface hover:text-text',
  quiet: 'text-muted hover:text-text',
  danger: 'text-diff-remove-fg hover:bg-diff-remove',
}

const sizes: Record<ButtonSize, { text: string; box: string; icon: string }> = {
  xs: { text: 'h-5 gap-1 px-1.5 text-xs', box: 'size-5', icon: 'size-3' },
  sm: { text: 'h-7 gap-1.5 px-2.5 text-xs', box: 'size-7', icon: 'size-3.5' },
  md: { text: 'h-8 gap-2 px-3 text-sm', box: 'size-8', icon: 'size-4' },
}

interface CommonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon. */
  icon?: IconName | undefined
  ref?: Ref<HTMLButtonElement> | undefined
}

/** Text button, optionally with a leading icon. */
export interface TextButtonProps extends CommonProps {
  iconOnly?: false
  label?: never
  children?: ReactNode
}

/** Square icon-only button. `label` is the accessible name and tooltip. */
export interface IconOnlyButtonProps extends CommonProps {
  iconOnly: true
  label: string
  children?: ReactNode
}

export type ButtonProps = TextButtonProps | IconOnlyButtonProps

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconOnly = false,
  label,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  const s = sizes[size]
  return (
    <button
      type={type}
      aria-label={iconOnly ? label : props['aria-label']}
      title={iconOnly ? label : props.title}
      className={[base, variants[variant], iconOnly ? s.box : s.text, className].join(
        ' ',
      )}
      {...props}
    >
      {icon && <Icon name={icon} className={s.icon} />}
      {children}
    </button>
  )
}
