/** One file change, resolved against the current workspace and ready for diff review. */
export interface FilePatch {
  path: string
  /** Text before the change, or null when the file is new. */
  base: string | null
  /** Full text after the change. */
  content: string
}

export type Phase =
  | 'idle'
  | 'planning'
  | 'plan-review'
  | 'executing'
  | 'diff-review'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface WorkflowState {
  phase: Phase
  task: string
  plan: string
  patches: FilePatch[]
  error: string | null
}
