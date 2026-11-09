import { idbAll, idbPut, openDB } from '../workspace/db'
import type { Phase } from './types'

/** A saved run. Holds the task, plan and file list only; never keys or file contents. */
export interface Run {
  id: string
  task: string
  plan: string
  phase: Phase
  planModel: string
  executeModel: string
  files: string[]
  error: string | null
  createdAt: number
  updatedAt: number
}

export async function saveRun(run: Run): Promise<void> {
  const db = await openDB()
  try {
    await idbPut(db, 'runs', run.id, run)
  } finally {
    db.close()
  }
}

/** Newest first. */
export async function listRuns(): Promise<Run[]> {
  const db = await openDB()
  try {
    return (await idbAll<Run>(db, 'runs')).sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}
