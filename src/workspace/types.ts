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

/**
 * A folder handle from the File System Access API with permission methods. Chromium
 * exposes these on directory handles obtained through `showDirectoryPicker()`.
 */
export interface PermissionedHandle {
  queryPermission(d: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(d: { mode: 'readwrite' }): Promise<PermissionState>
}

/** The folder the user picked for a workspace. */
export type LinkedFolder = FileSystemDirectoryHandle & PermissionedHandle

/**
 * The single file the user picked for a one-file workspace. File handles expose the
 * same permission methods as directory handles.
 */
export type LinkedFile = FileSystemFileHandle & PermissionedHandle

export interface Entry {
  /** Base name. */
  name: string
  /** Workspace-relative path, `/` separated, no leading slash. */
  path: string
  kind: 'file' | 'dir'
  /** Bytes; files only. */
  size?: number
  /** Last modified, ms since the epoch; files only, when the backend reports it. */
  mtime?: number
}

/**
 * A file system scoped to one workspace. Paths are workspace-relative and
 * normalized (see `path.ts`); the root directory is the empty string.
 */
export interface WorkspaceFS {
  /**
   * Direct children of `dir`, directories first, then by name. `sizes: false` skips the
   * per-file size read, which is the slow part on a browser folder.
   */
  list(dir: string, opts?: { sizes?: boolean }): Promise<Entry[]>
  /**
   * Every entry of the workspace in depth-first order (see `depthFirst` in `path.ts`).
   * One call for the whole tree, so backends can avoid a round trip per directory.
   */
  /** `onProgress` receives the running entry count while a large folder is read. */
  listAll(onProgress?: (count: number) => void): Promise<Entry[]>
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
