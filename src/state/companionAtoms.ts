import { atom } from 'jotai'

export type CompanionView = 'chat' | 'config'

/** True while the AI Companion tab exists (opened, not yet closed). */
export const companionOpenAtom = atom(false)
/** True while the AI Companion tab, not a file tab, is the focused one. */
export const companionTabActiveAtom = atom(false)
/** Which page of the companion is showing. */
export const companionViewAtom = atom<CompanionView>('chat')
/** The right-hand chat sidecar, beside the editor. */
export const sidecarOpenAtom = atom(false)
