import { atom } from 'jotai'

/**
 * Set when a newer version of the app is ready (or a stale tab failed to load a chunk).
 * `apply` activates it. It is never applied automatically: the editor holds unsaved buffers.
 */
export interface PendingUpdate {
  message: string
  apply: () => void
}

export const pendingUpdateAtom = atom<PendingUpdate | null>(null)
