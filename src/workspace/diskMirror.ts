import { splitPath } from './path'

/**
 * Permission methods of the File System Access API. They are not in TypeScript's DOM
 * library yet, so they are declared here.
 */
interface PermissionedHandle {
  queryPermission(d: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(d: { mode: 'readwrite' }): Promise<PermissionState>
}

/** The folder the user picked, through the File System Access API. */
export type LinkedFolder = FileSystemDirectoryHandle & PermissionedHandle

/**
 * Writes workspace changes through to the folder the user picked, so the files on disk
 * (and git) see them. The workspace stays the source the editor reads; this only
 * mirrors. Paths are workspace-relative, as everywhere else.
 */
export class DiskMirror {
  readonly root: LinkedFolder

  constructor(root: LinkedFolder) {
    this.root = root
  }

  /** Checks readwrite access without prompting. */
  permission(): Promise<PermissionState> {
    return this.root.queryPermission({ mode: 'readwrite' })
  }

  /** Asks for readwrite access. Must run from a user gesture (a click). */
  requestAccess(): Promise<PermissionState> {
    return this.root.requestPermission({ mode: 'readwrite' })
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const { dir, name } = await this.parent(path, true)
    const file = await dir.getFileHandle(name, { create: true })
    const out = await file.createWritable()
    await out.write(data as BufferSource)
    await out.close()
  }

  async mkdir(path: string): Promise<void> {
    await this.dir(splitPath(path), true)
  }

  /** Removes a file or folder tree. Missing paths are fine: the goal is that they are gone. */
  async remove(path: string): Promise<void> {
    const parts = splitPath(path)
    const name = parts.pop()
    if (name === undefined) throw new Error('Cannot remove the folder root')
    let dir: FileSystemDirectoryHandle
    try {
      dir = await this.dir(parts, false)
    } catch (e) {
      if (isNotFound(e)) return
      throw e
    }
    try {
      await dir.removeEntry(name, { recursive: true })
    } catch (e) {
      if (!isNotFound(e)) throw e
    }
  }

  private async dir(
    parts: string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let d: FileSystemDirectoryHandle = this.root
    for (const part of parts) d = await d.getDirectoryHandle(part, { create })
    return d
  }

  private async parent(path: string, create: boolean) {
    const parts = splitPath(path)
    const name = parts.pop()
    if (name === undefined) throw new Error('Cannot write to the folder root')
    return { dir: await this.dir(parts, create), name }
  }
}

export function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError'
}

export function isAccessDenied(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotAllowedError'
}
