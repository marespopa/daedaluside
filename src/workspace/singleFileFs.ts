import { decodeText, encodeText, normalizePath } from './path'
import { FSError, type Entry, type WorkspaceFS } from './types'

/**
 * A workspace file system over one file the user picked through the File System
 * Access API. The "root" holds exactly that file; the workspace cannot grow or
 * reshape, so mkdir/rename/remove are rejected up front and the tree edit keys
 * surface notices instead of raw FS failures.
 */
export class SingleFileFS implements WorkspaceFS {
  private readonly file: FileSystemFileHandle
  private readonly name: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(file: FileSystemFileHandle) {
    this.file = file
    this.name = file.name
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(() => fn())
    this.queue = p.catch(() => {})
    return p
  }

  /** True for paths that address the file itself, e.g. `f.txt` or `f.txt/x`. */
  private underFile(p: string): boolean {
    return p === this.name || p.startsWith(`${this.name}/`)
  }

  async list(dir: string): Promise<Entry[]> {
    const p = normalizePath(dir)
    if (p === '') {
      return [
        {
          name: this.name,
          path: this.name,
          kind: 'file',
          size: (await this.file.getFile()).size,
        },
      ]
    }
    if (this.underFile(p)) throw new FSError('ENOTDIR', `Not a directory: ${p}`)
    throw new FSError('ENOENT', `No such directory: ${p}`)
  }

  /** Same single entry, so the one-file workspace lists without a walk. */
  listAll(): Promise<Entry[]> {
    return this.list('')
  }

  async stat(path: string): Promise<Entry | null> {
    const p = normalizePath(path)
    if (p === '') return { name: '', path: '', kind: 'dir' }
    if (p !== this.name) return null
    return {
      name: this.name,
      path: this.name,
      kind: 'file',
      size: (await this.file.getFile()).size,
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
    if (p !== this.name) {
      throw new FSError(this.underFile(p) ? 'ENOTDIR' : 'ENOENT', `No such file: ${p}`)
    }
    return new Uint8Array(await (await this.file.getFile()).arrayBuffer())
  }

  async read(path: string): Promise<string> {
    return decodeText(await this.readBytes(path))
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
    if (p !== this.name) {
      throw new FSError(this.underFile(p) ? 'ENOTDIR' : 'ENOENT', `No such file: ${p}`)
    }
    await this.enqueue(async () => {
      // createWritable truncates by default, so a close always replaces the whole
      // file; a failing write aborts and leaves the old content untouched.
      const writer = await this.file.createWritable()
      try {
        await writer.write(data as BufferSource)
      } catch (e) {
        try {
          await writer.abort()
        } catch {
          /* ignore */
        }
        throw e
      }
      await writer.close()
    })
  }

  write(path: string, content: string): Promise<void> {
    return this.writeBytes(path, encodeText(content))
  }

  async mkdir(path?: string): Promise<void> {
    throw new FSError('EINVAL', `A single-file workspace has no folders (got ${path})`)
  }

  async remove(path?: string): Promise<void> {
    throw new FSError(
      'EINVAL',
      `A single-file workspace cannot delete ${path ?? 'its file'}`,
    )
  }

  async rename(from?: string, to?: string): Promise<void> {
    throw new FSError('EINVAL', `A single-file workspace cannot rename ${from} to ${to}`)
  }
}
