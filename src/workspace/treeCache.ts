import { idbGet, idbPut, openDB } from './db'
import type { Entry } from './types'

const key = (wsId: string) => `tree:${wsId}`

/** Remembers a workspace's whole file list so the next open can show it at once. */
export async function saveTreeCache(wsId: string, entries: readonly Entry[]) {
  try {
    const db = await openDB()
    try {
      await idbPut(db, 'snapshots', key(wsId), entries)
    } finally {
      db.close()
    }
  } catch {
    // storage may be unavailable or full; the next open just walks the folder
  }
}

/** The file list saved by the last full read, or null when none (or it cannot be read). */
export async function loadTreeCache(wsId: string): Promise<Entry[] | null> {
  try {
    const db = await openDB()
    try {
      const v = await idbGet<Entry[]>(db, 'snapshots', key(wsId))
      return Array.isArray(v) && v.length > 0 ? v : null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}
