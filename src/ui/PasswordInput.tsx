import { useState } from 'react'
import { Button } from './Button'
import { Input, type InputProps } from './Input'

/**
 * A secret field with a Show/Hide toggle. Showing the text helps on phones, where typing
 * into dots is error-prone.
 *
 * It is a text input that is masked with CSS, not `type="password"`. Password managers
 * (NordPass, 1Password, LastPass, Bitwarden) attach to password fields and can swallow or
 * rewrite keystrokes; these secrets are for this app's own vault, not a login, so the
 * fields also opt out of each of them. Autocorrect and capitalisation are off so the
 * soft keyboard does not rewrite what is typed.
 */
export function PasswordInput({
  className = '',
  variant = 'outlined',
  ...props
}: Omit<InputProps, 'type'> & { 'aria-label': string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Input
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        data-form-type="other"
        data-np-ignore="true"
        {...props}
        variant={variant}
        inputClassName={shown ? '' : '[-webkit-text-security:disc]'}
        className="min-w-0 flex-1"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-pressed={shown}
        aria-label={`${shown ? 'Hide' : 'Show'} ${props['aria-label']}`}
        onClick={() => setShown(!shown)}
      >
        {shown ? 'Hide' : 'Show'}
      </Button>
    </div>
  )
}
