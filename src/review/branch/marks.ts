import type { BranchFile } from '../../workspace/gitService'

/** What a file looked like when it was marked reviewed: the blob oid on each side. */
export interface Mark {
  mb: string | null
  head: string | null
}
export type Marks = Record<string, Mark>

export function marksKey(workspaceId: string, base: string, branch: string): string {
  return `daedalus.branchReview.${workspaceId}.${base}.${branch}`
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadMarks(key: string): Marks {
  try {
    const raw = storage()?.getItem(key)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Marks
  } catch {
    return {}
  }
}

export function saveMarks(key: string, marks: Marks) {
  try {
    const s = storage()
    if (!s) return
    if (Object.keys(marks).length === 0) s.removeItem(key)
    else s.setItem(key, JSON.stringify(marks))
  } catch {
    // Storage can be full or blocked; marks then last for the session only.
  }
}

/** A mark counts only while both sides of the file are still what was reviewed. */
export function isReviewed(marks: Marks, file: BranchFile): boolean {
  const m = marks[file.path]
  return m !== undefined && m.mb === file.mbOid && m.head === file.headOid
}

/** Marks for paths that are no longer in the changeset, or whose content moved on, are dropped. */
export function pruneMarks(marks: Marks, files: readonly BranchFile[]): Marks {
  const out: Marks = {}
  for (const f of files) if (isReviewed(marks, f)) out[f.path] = marks[f.path]!
  return out
}

export function markFile(marks: Marks, file: BranchFile, reviewed: boolean): Marks {
  const next = { ...marks }
  if (reviewed) next[file.path] = { mb: file.mbOid, head: file.headOid }
  else delete next[file.path]
  return next
}
