export type FSErrorCode =
  'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EINVAL'

export class FSError extends Error {
  readonly code: FSErrorCode
  constructor(code: FSErrorCode, message: string) {
    super(message)
    this.name = 'FSError'
    this.code = code
  }
}

export interface Entry {
  /** Base name. */
  name: string
  /** Workspace-relative path, `/` separated, no leading slash. */
  path: string
  kind: 'file' | 'dir'
  /** Bytes; files only. */
  size?: number
}

/**
 * A file system scoped to one workspace. Paths are workspace-relative and
 * normalized (see `path.ts`); the root directory is the empty string.
 */
export interface WorkspaceFS {
  /** Direct children of `dir`, directories first, then by name. */
  list(dir: string): Promise<Entry[]>
  /**
   * Every entry of the workspace in depth-first order (see `depthFirst` in `path.ts`).
   * One call for the whole tree, so backends can avoid a round trip per directory.
   */
  listAll(): Promise<Entry[]>
  stat(path: string): Promise<Entry | null>
  read(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  /** Atomic: readers see the old or the new content, never a partial file. Creates parents. */
  write(path: string, content: string): Promise<void>
  writeBytes(path: string, data: Uint8Array): Promise<void>
  /** Creates the directory and any missing parents. No-op if it already exists. */
  mkdir(path: string): Promise<void>
  /** Removes a file or a directory tree. Throws ENOENT if missing. */
  remove(path: string): Promise<void>
  /** Moves a file or directory. Throws EEXIST if `to` exists. Creates parents of `to`. */
  rename(from: string, to: string): Promise<void>
}

export interface OpenOptions {
  /**
   * Writes fail once the workspace record is gone (deleted, possibly in another tab),
   * so a stale tab cannot recreate files for a deleted workspace.
   */
  requireWorkspace?: boolean
}

export interface FSBackend {
  readonly kind: 'idb'
  open(workspaceId: string, opts?: OpenOptions): WorkspaceFS
  /**
   * Deletes a workspace: its files, its metadata and its linked-folder record, in one
   * transaction so no write can land in between.
   */
  destroy(workspaceId: string): Promise<void>
  close(): void
}
