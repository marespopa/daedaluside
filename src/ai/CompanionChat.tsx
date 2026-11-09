import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { companionViewAtom } from '../state/companionAtoms'
import { Button, Textarea } from '../ui'
import {
  chatBusyAtom,
  chatMessagesAtom,
  clearChat,
  NEEDS_CONFIG,
  sendChat,
  stopChat,
} from './chat'
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

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages])

  const send = () => {
    const text = draft
    if (!text.trim() || busy) return
    setDraft('')
    void sendChat(store, text)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && (
          <p className="text-muted">
            Ask anything about code. The AI can read your workspace files, and edit them
            when you ask (undo with Ctrl-Z). Replies come from your Plan model. Change the
            model or add a key under Configure.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="anim-fade space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              {m.role === 'user' ? 'You' : 'AI'}
            </p>
            {(m.content || (!m.error && !m.calls?.length)) && (
              <p className="break-words whitespace-pre-wrap">{m.content || '…'}</p>
            )}
            {m.calls && m.calls.length > 0 && (
              <ul aria-label="Tool calls" className="space-y-0.5 text-xs text-muted">
                {m.calls.map(({ call, result }) => (
                  <li key={call.id} className="break-words">
                    {describeCall(call)} ·{' '}
                    {!result
                      ? 'running…'
                      : result.isError
                        ? `failed: ${result.content}`
                        : 'done'}
                  </li>
                ))}
              </ul>
            )}
            {m.error && (
              <div role="alert" className="space-y-1">
                <p className="text-diff-remove-fg">Error: {m.error}</p>
                {NEEDS_CONFIG.test(m.error) && (
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
        <Textarea
          aria-label="Message"
          autoFocus={autoFocus}
          placeholder="Message the AI. Enter to send, Shift+Enter for a new line"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className="min-w-0 flex-1 resize-none"
        />
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
