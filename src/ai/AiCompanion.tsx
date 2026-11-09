import { useAtom, useAtomValue } from 'jotai'
import {
  companionTabActiveAtom,
  companionViewAtom,
  type CompanionView,
} from '../state/companionAtoms'
import { Tabs } from '../ui'
import AiSettings from './AiSettings'
import CompanionChat from './CompanionChat'

const VIEWS = [
  { id: 'chat', label: 'Chat' },
  { id: 'config', label: 'Configure' },
]

/**
 * The AI Companion page: chat, and the AI configuration that used to live in a dialog.
 * Stays mounted while its tab exists, hidden when another tab is focused, so a reply
 * keeps streaming and the draft survives a tab switch.
 */
export default function AiCompanion() {
  const active = useAtomValue(companionTabActiveAtom)
  const [view, setView] = useAtom(companionViewAtom)
  return (
    <div
      id="ai-companion"
      hidden={!active}
      className="anim-fade absolute inset-0 z-10 flex-col bg-canvas font-sans text-sm [&:not([hidden])]:flex"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pt-4">
        <h2 className="mb-3 text-base font-medium">AI Companion</h2>
        <Tabs
          label="AI Companion sections"
          tabs={VIEWS}
          value={view}
          onChange={(v) => setView(v as CompanionView)}
          className="flex min-h-0 flex-1 flex-col"
          panelClassName="flex min-h-0 flex-1 flex-col"
        >
          {view === 'chat' ? (
            <CompanionChat />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              <AiSettings />
            </div>
          )}
        </Tabs>
      </div>
    </div>
  )
}
