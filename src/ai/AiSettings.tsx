import { useCallback, useEffect, useState } from 'react'
import { createProvider, needsKey, PROVIDER_IDS } from '../providers'
import type { ProviderId } from '../providers'
import { loadRoutes, saveRoute, STAGES } from '../router/router'
import type { Routes, Stage } from '../router/router'
import { Button, Combobox, PasswordInput, Select } from '../ui'
import { configuredProviders, DEFAULT_MODEL, fallbackRoute } from './providerChoices'
import {
  createVault,
  getKey,
  listProviders,
  lock,
  removeKey,
  resetVault,
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
const KEYED = PROVIDER_IDS.filter(needsKey)

/** The provider's real model ids, fetched once a key is saved. */
function useModels(provider: ProviderId, ready: boolean) {
  const [state, setState] = useState<{
    provider: ProviderId
    ids: string[]
    error: string | null
  } | null>(null)
  useEffect(() => {
    if (!ready) return
    const ctl = new AbortController()
    const apiKey = needsKey(provider) ? getKey(provider) : undefined
    createProvider(provider, apiKey ? { apiKey } : {})
      .listModels(ctl.signal)
      .then((list) => setState({ provider, ids: list.map((m) => m.id), error: null }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        const error = e instanceof Error ? e.message : 'Could not load models'
        setState({ provider, ids: [], error })
      })
    return () => ctl.abort()
  }, [provider, ready])
  const mine = state?.provider === provider && ready ? state : null
  const empty = !ready
    ? `Save a ${PROVIDER_LABEL[provider]} API key to list its models`
    : !mine
      ? 'Loading models…'
      : (mine.error ?? 'No models found')
  return { ids: mine?.ids ?? [], empty }
}

/** The AI section of Settings: key vault, provider keys, and which model handles each stage. */
export default function AiSettings() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [routes, setRoutes] = useState<Routes | null>(null)
  const configured = configuredProviders(saved)
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

  // A stage whose provider is not configured (a key was removed, or none was ever saved)
  // moves to a configured one with that provider's default model. Only once the vault is
  // unlocked, so a locked vault never rewrites the saved routes.
  const stageProviders = routes ? STAGES.map((s) => routes[s].provider).join() : ''
  useEffect(() => {
    if (!routes || status !== 'unlocked') return
    const fallback = fallbackRoute(configured)
    if (!fallback) return
    const stale = STAGES.filter((s) => !configured.includes(routes[s].provider))
    if (!stale.length) return
    void (async () => {
      let next = routes
      for (const stage of stale) next = await saveRoute(stage, fallback)
      setRoutes(next)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, saved, stageProviders])

  const changeRoute = async (stage: Stage, provider: ProviderId, model: string) => {
    if (!model.trim()) return
    setRoutes(await saveRoute(stage, { provider, model }))
  }

  return (
    <section aria-labelledby="ai-h" className="space-y-4">
      <div className="space-y-1">
        <h3 id="ai-h" className="text-xs tracking-wide text-muted uppercase">
          AI
        </h3>
        <p className="text-muted">
          To use AI you add an API key from Gemini or Anthropic. Keys are stored only in
          this browser, locked by a vault passphrase that you choose. Requests go straight
          to the provider.
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-medium">1. Vault passphrase</p>
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
            <ResetVault onDone={refresh} />
          </>
        ) : (
          <VaultGate status={status} onDone={refresh} />
        )}
      </div>

      <div className="space-y-2">
        <p className="font-medium">2. API keys</p>
        {status === 'unlocked' ? (
          <>
            <p className="text-muted">
              One key per provider, shared by the Plan and Edit models.
            </p>
            {KEYED.map((p) => (
              <KeyRow
                key={p}
                provider={p}
                stored={saved.includes(p)}
                onChange={refresh}
              />
            ))}
          </>
        ) : (
          <p className="text-muted">
            {status === 'none'
              ? 'Create the vault first, then you can add keys here.'
              : 'Unlock the vault to add or change keys.'}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="font-medium">3. Models</p>
        <p className="text-muted">
          Plan drafts the change; Edit writes the patch. Pick a provider and model for
          each.
        </p>
        {routes && status !== null && configured.length === 0 && (
          <p className="text-muted">
            {status === 'unlocked'
              ? 'No providers configured. Add an API key in step 2.'
              : status === 'locked'
                ? 'No providers available. Unlock the vault in step 1 to use your saved keys.'
                : 'No providers configured. Create the vault in step 1 and add an API key.'}
          </p>
        )}
        {routes &&
          configured.length > 0 &&
          STAGES.map((stage) => (
            <RouteRow
              key={stage}
              stage={stage}
              route={routes[stage]}
              providers={configured}
              ready={
                !needsKey(routes[stage].provider) ||
                saved.includes(routes[stage].provider)
              }
              onChange={(provider, model) => void changeRoute(stage, provider, model)}
            />
          ))}
      </div>
    </section>
  )
}

/** Deletes the vault after an explicit confirmation. The way out of a forgotten passphrase. */
function ResetVault({ onDone }: { onDone: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Reset vault…
      </Button>
    )
  }
  return (
    <div role="alertdialog" aria-label="Reset vault" className="space-y-2">
      <p>
        This permanently deletes the vault and every API key in it. You can then create a
        new vault with a new passphrase. Your files and other settings are not affected.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="danger"
          onClick={() =>
            void resetVault().then(async () => {
              setConfirming(false)
              await onDone()
            })
          }
        >
          Delete vault and keys
        </Button>
        <Button size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
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
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creating = status === 'none'

  const submit = async () => {
    if (!pass) return setError('Enter a passphrase.')
    if (creating && pass !== again) return setError('The two passphrases do not match.')
    setBusy(true)
    setError(null)
    try {
      await (creating ? createVault(pass) : unlock(pass))
      setPass('')
      setAgain('')
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
      <p className="text-muted">
        {creating
          ? 'Choose a passphrase. It is new, not your Google or Anthropic password. It encrypts your keys here and you enter it once each time you open the app.'
          : 'Enter your vault passphrase to unlock your keys.'}
      </p>
      <PasswordInput
        aria-label={creating ? 'New vault passphrase' : 'Vault passphrase'}
        placeholder={creating ? 'New passphrase' : 'Passphrase'}
        value={pass}
        disabled={busy}
        onChange={(e) => setPass(e.currentTarget.value)}
        className="w-full"
      />
      {creating && (
        <PasswordInput
          aria-label="Repeat vault passphrase"
          placeholder="Repeat passphrase"
          value={again}
          disabled={busy}
          onChange={(e) => setAgain(e.currentTarget.value)}
          className="w-full"
        />
      )}
      {error && (
        <p role="alert" className="text-diff-remove-fg">
          Error: {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={busy}>
        {busy
          ? creating
            ? 'Creating…'
            : 'Unlocking…'
          : creating
            ? 'Create vault'
            : 'Unlock'}
      </Button>
      {creating ? (
        <p className="text-muted">
          A lost passphrase cannot be recovered. You would reset the vault and add your
          keys again.
        </p>
      ) : (
        <ResetVault onDone={onDone} />
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
    <div className="space-y-1">
      <p className="text-xs text-muted">
        {PROVIDER_LABEL[provider]}
        {stored ? ' · ✓ key saved' : ' · no key yet'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <PasswordInput
          aria-label={label}
          placeholder={stored ? 'Saved. Paste a new key to replace it' : label}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.currentTarget.value)}
          className="min-w-48 flex-1"
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
    </div>
  )
}

function RouteRow({
  stage,
  route,
  providers,
  ready,
  onChange,
}: {
  stage: Stage
  route: { provider: ProviderId; model: string }
  providers: ProviderId[]
  ready: boolean
  onChange: (provider: ProviderId, model: string) => void
}) {
  const models = useModels(route.provider, ready)
  const label = STAGE_LABEL[stage]
  // Keep the saved provider selectable even if it is not configured, so the control never
  // shows a blank value while the fallback is being saved.
  const options = (
    providers.includes(route.provider) ? providers : [...providers, route.provider]
  ).map((id) => ({ value: id, label: PROVIDER_LABEL[id] }))
  return (
    <div className="flex items-center justify-between gap-2">
      <span id={`route-${stage}`}>{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <Select
          aria-label={`${label} provider`}
          value={route.provider}
          options={options}
          onChange={(p) => onChange(p as ProviderId, DEFAULT_MODEL[p as ProviderId])}
        />
        <Combobox
          aria-label={`${label} name`}
          value={route.model}
          options={models.ids}
          empty={models.empty}
          onCommit={(m) => onChange(route.provider, m)}
          className="w-40"
        />
      </div>
    </div>
  )
}
