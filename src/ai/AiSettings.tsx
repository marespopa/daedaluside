import { useCallback, useEffect, useState } from 'react'
import { needsKey, PROVIDER_IDS } from '../providers'
import type { ProviderId } from '../providers'
import { loadRoutes, saveRoute, STAGES } from '../router/router'
import type { Routes, Stage } from '../router/router'
import { Button, Input, Select } from '../ui'
import {
  createVault,
  listProviders,
  lock,
  removeKey,
  setKey,
  unlock,
  vaultStatus,
  WrongPassphraseError,
} from '../vault/vault'
import type { VaultStatus } from '../vault/vault'

const STAGE_LABEL: Record<Stage, string> = { plan: 'Plan model', execute: 'Edit model' }
const PROVIDER_LABEL: Record<ProviderId, string> = {
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  ollama: 'Ollama (local)',
}
const PROVIDER_OPTIONS = PROVIDER_IDS.map((id) => ({
  value: id,
  label: PROVIDER_LABEL[id],
}))
const KEYED = PROVIDER_IDS.filter(needsKey)

/** The AI section of Settings: key vault, provider keys, and which model handles each stage. */
export default function AiSettings() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [routes, setRoutes] = useState<Routes | null>(null)

  const refresh = useCallback(async () => {
    const s = await vaultStatus()
    setStatus(s)
    setSaved(s === 'unlocked' ? listProviders() : [])
  }, [])

  useEffect(() => {
    let live = true
    void vaultStatus().then((s) => {
      if (!live) return
      setStatus(s)
      setSaved(s === 'unlocked' ? listProviders() : [])
    })
    void loadRoutes().then((r) => live && setRoutes(r))
    return () => {
      live = false
    }
  }, [])

  const changeRoute = async (stage: Stage, provider: ProviderId, model: string) => {
    if (!model.trim()) return
    setRoutes(await saveRoute(stage, { provider, model }))
  }

  return (
    <section aria-labelledby="ai-h" className="mt-5 space-y-3">
      <h3 id="ai-h" className="text-xs tracking-wide text-muted uppercase">
        AI
      </h3>
      <p className="text-muted">
        Your keys stay in this browser, encrypted with your passphrase. Requests go
        straight to the provider.
      </p>
      {status === null ? null : status === 'unlocked' ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p>Key vault is unlocked</p>
            <Button
              size="sm"
              onClick={() => {
                lock()
                void refresh()
              }}
            >
              Lock
            </Button>
          </div>
          {KEYED.map((p) => (
            <KeyRow key={p} provider={p} stored={saved.includes(p)} onChange={refresh} />
          ))}
        </>
      ) : (
        <VaultGate status={status} onDone={refresh} />
      )}
      {routes &&
        STAGES.map((stage) => (
          <RouteRow
            key={stage}
            stage={stage}
            route={routes[stage]}
            onChange={(provider, model) => void changeRoute(stage, provider, model)}
          />
        ))}
    </section>
  )
}

function VaultGate({
  status,
  onDone,
}: {
  status: 'none' | 'locked'
  onDone: () => Promise<void>
}) {
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creating = status === 'none'

  const submit = async () => {
    if (!pass) return setError('Enter a passphrase.')
    setBusy(true)
    setError(null)
    try {
      await (creating ? createVault(pass) : unlock(pass))
      setPass('')
      await onDone()
    } catch (e) {
      setError(
        e instanceof WrongPassphraseError
          ? 'Wrong passphrase.'
          : 'Could not open the vault.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          type="password"
          aria-label={creating ? 'New vault passphrase' : 'Vault passphrase'}
          placeholder={creating ? 'Choose a passphrase' : 'Passphrase'}
          autoComplete={creating ? 'new-password' : 'current-password'}
          value={pass}
          disabled={busy}
          onChange={(e) => setPass(e.currentTarget.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy
            ? creating
              ? 'Creating…'
              : 'Unlocking…'
            : creating
              ? 'Create vault'
              : 'Unlock'}
        </Button>
      </div>
      {creating && (
        <p className="text-muted">
          There is no way to recover a lost passphrase; you would add your keys again.
        </p>
      )}
      {error && (
        <p role="alert" className="text-diff-remove-fg">
          Error: {error}
        </p>
      )}
    </form>
  )
}

function KeyRow({
  provider,
  stored,
  onChange,
}: {
  provider: ProviderId
  stored: boolean
  onChange: () => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const label = `${PROVIDER_LABEL[provider]} API key`

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      setValue('')
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="password"
        aria-label={label}
        placeholder={stored ? 'Saved. Paste a new key to replace it' : label}
        autoComplete="off"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.currentTarget.value)}
        className="min-w-0 flex-1"
      />
      <Button
        size="sm"
        disabled={busy || !value.trim()}
        aria-label={`Save ${label}`}
        onClick={() => void run(() => setKey(provider, value.trim()))}
      >
        Save
      </Button>
      {stored && (
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          aria-label={`Remove ${label}`}
          onClick={() => void run(() => removeKey(provider))}
        >
          Remove
        </Button>
      )}
    </div>
  )
}

function RouteRow({
  stage,
  route,
  onChange,
}: {
  stage: Stage
  route: { provider: ProviderId; model: string }
  onChange: (provider: ProviderId, model: string) => void
}) {
  // What the user is typing; null shows the saved model name.
  const [draft, setDraft] = useState<string | null>(null)
  const model = draft ?? route.model
  const commit = () => {
    setDraft(null)
    if (model !== route.model) onChange(route.provider, model)
  }
  const label = STAGE_LABEL[stage]
  return (
    <div className="flex items-center justify-between gap-2">
      <span id={`route-${stage}`}>{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <Select
          aria-label={`${label} provider`}
          value={route.provider}
          options={PROVIDER_OPTIONS}
          onChange={(p) => onChange(p as ProviderId, model)}
        />
        <Input
          aria-label={`${label} name`}
          value={model}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="w-40"
        />
      </div>
    </div>
  )
}
