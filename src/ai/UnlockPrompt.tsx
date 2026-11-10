import { useState } from 'react'
import { Button, PasswordInput } from '../ui'
import { unlock, WrongPassphraseError } from '../vault/vault'

/**
 * Unlocks the key vault without leaving the chat. The passphrase goes straight to `unlock`
 * and is cleared; nothing is stored. `onUnlocked` lets the caller carry on (resend a message).
 */
export default function UnlockPrompt({
  onUnlocked,
  autoFocus,
}: {
  onUnlocked: () => void
  autoFocus?: boolean
}) {
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!pass) return setError('Enter your passphrase.')
    setBusy(true)
    setError(null)
    try {
      await unlock(pass)
      setPass('')
      onUnlocked()
    } catch (e) {
      setError(
        e instanceof WrongPassphraseError ? 'Wrong passphrase.' : 'Could not unlock.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      aria-label="Unlock key vault"
      className="anim-fade space-y-2 rounded-md border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="font-medium">🔒 Unlock your keys to use the AI</p>
      <PasswordInput
        aria-label="Vault passphrase"
        placeholder="Vault passphrase"
        autoFocus={autoFocus}
        value={pass}
        disabled={busy}
        onChange={(e) => setPass(e.currentTarget.value)}
        className="w-full"
      />
      {error && (
        <p role="alert" className="text-diff-remove-fg">
          Error: {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </Button>
    </form>
  )
}
