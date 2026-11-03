import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Button, type ButtonVariant, type ButtonSize } from './Button'
import type { IconName } from './Icon'

/**
 * Square icon-only button, the shared style from Button. Pass an icon name, or
 * children for a custom glyph. `label` is required: it becomes the accessible name
 * and tooltip.
 */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className,
  children,
  ...props
}: {
  label: string
  icon?: IconName | undefined
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  className?: string | undefined
  children?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <Button
      iconOnly
      label={label}
      icon={icon}
      variant={variant}
      size={size}
      className={className}
      {...props}
    >
      {children}
    </Button>
  )
}
