import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { companionViewAtom } from '../state/companionAtoms'
import { Button, Textarea } from '../ui'
import {
  chatBusyAtom,
  chatMessagesAtom,
  clearChat,
  NEEDS_CONFIG,
  NEEDS_UNLOCK,
  retryChat,
  stopChat,
} from './chat'
import UnlockPrompt from './UnlockPrompt'
import { loadRoutes } from '../router/router'
import { needsKey } from '../providers'
import { vaultStatus } from '../vault/vault'
import { matchCommands, submitChatInput } from './slashCommands'
import { describeCall } from './companionTools'

/** Chat with the Plan model. History lives in atoms, so a sidecar can show the same thread. */
export default function CompanionChat({
  onConfigure,
  autoFocus,
}: { onConfigure?: () => void; autoFocus?: boolean } = {}) {
  const store = useStore()
  const messages = useAtomValue(chatMessagesAtom)
  const busy = useAtomValue(chatBusyAtom)
  const setView = useSetAtom(companionViewAtom)
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)
  // True when the chat's model needs a key and the vault is locked: ask before the first send.
  const [locked, setLocked] = useState(false)
  const [lockedHint, setLockedHint] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [status, routes] = await Promise.all([vaultStatus(), loadRoutes()])
        if (live) setLocked(status === 'locked' && needsKey(routes.plan.provider))
      } catch {
        if (live) setLocked(false)
      }
    })()
    return () => {
      live = false
    }
  }, [messages.length, lockedHint])

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages])

  const send = () => {
    const text = draft
    if (!text.trim()) return
    const isCommand = /^\/\S/.test(text.trim())
    if (busy && !isCommand) return
    // A half-typed command that matches exactly one command runs that command.
    const only = matchCommands(text.trim())
    const line = only.length === 1 ? `/${only[0]!.name}` : text
    setDraft('')
    void submitChatInput(store, line)
  }

  const suggestions = busy ? [] : matchCommands(draft)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {locked && (
          <UnlockPrompt
            onUnlocked={() => {
              setLocked(false)
              setLockedHint((n) => n + 1)
            }}
          />
        )}
        {messages.length === 0 && (
          <p className="text-muted">Ask about your code. Type / for commands.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="anim-fade space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              {m.role === 'user' ? 'You' : m.notice ? 'Note' : 'AI'}
            </p>
            {(m.content || (!m.error && !m.calls?.length)) && (
              <p className="break-words whitespace-pre-wrap">{m.content || '…'}</p>
            )}
            {m.calls && m.calls.length > 0 && (
              <ul aria-label="Tool calls" className="space-y-0.5 text-xs text-muted">
                {m.calls.map(({ call, result, progress }) => (
                  <li key={call.id} className="break-words">
                    {describeCall(call)} ·{' '}
                    {!result
                      ? `running…${progress ? ` ${progress}` : ''}`
                      : result.isError
                        ? `failed: ${result.content}`
                        : call.name === 'run_agent'
                          ? `done${progress ? ` (${progress})` : ''}`
                          : 'done'}
                    {call.name === 'run_agent' && result && !result.isError && (
                      <details className="mt-0.5">
                        <summary className="cursor-pointer">Report</summary>
                        <p className="mt-1 whitespace-pre-wrap">{result.content}</p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {m.error && (
              <div role="alert" className="space-y-1">
                <p className="text-diff-remove-fg">Error: {m.error}</p>
                {NEEDS_UNLOCK.test(m.error) && (
                  <UnlockPrompt
                    autoFocus
                    onUnlocked={() => {
                      setLocked(false)
                      void retryChat(store)
                    }}
                  />
                )}
                {NEEDS_CONFIG.test(m.error) && !NEEDS_UNLOCK.test(m.error) && (
                  <Button
                    size="sm"
                    onClick={() => (onConfigure ? onConfigure() : setView('config'))}
                  >
                    Open Configure
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <div className="relative min-w-0 flex-1">
          {suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Commands"
              className="anim-pop absolute right-0 bottom-full left-0 mb-1 overflow-hidden rounded-md border border-line bg-canvas text-sm shadow-lg"
            >
              {suggestions.map((c) => (
                <li key={c.name} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="flex w-full gap-2 px-3 py-1.5 text-left hover:bg-surface"
                    onClick={() => {
                      setDraft('')
                      void submitChatInput(store, `/${c.name}`)
                    }}
                  >
                    <span className="font-medium">/{c.name}</span>
                    <span className="text-muted">{c.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Textarea
            aria-label="Message"
            autoFocus={autoFocus}
            placeholder="Message the AI"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey && suggestions.length) {
                e.preventDefault()
                setDraft(`/${suggestions[0]!.name} `)
                return
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            className="w-full resize-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          {busy ? (
            <Button type="button" size="sm" onClick={stopChat}>
              Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              Send
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={messages.length === 0}
            onClick={() => clearChat(store)}
          >
            Clear
          </Button>
        </div>
      </form>
    </div>
  )
}
