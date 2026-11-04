import {
  basename,
  compareEntries,
  decodeText,
  depthFirst,
  dirname,
  encodeText,
  isWithin,
  joinPath,
  normalizePath,
  splitPath,
} from './path'
import { walkInWorker } from './walkService'
import { FSError, type Entry, type WorkspaceFS } from './types'

function mapDomException(e: unknown, expected: 'file' | 'dir'): never {
  if (e instanceof FSError) throw e
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotFoundError':
        throw new FSError('ENOENT', e.message)
      case 'TypeMismatchError':
        throw new FSError(expected === 'file' ? 'EISDIR' : 'ENOTDIR', e.message)
      case 'InvalidModificationError':
        throw new FSError('ENOTEMPTY', e.message)
      case 'NoModificationAllowedError':
        throw new FSError('EINVAL', e.message)
      default:
        break
    }
  }
  throw e
}

/**
 * A workspace file system backed directly by a folder the user picked through the
 * File System Access API. The root directory of the workspace is the picked folder
 * itself; paths are workspace-relative and the empty string denotes the root.
 */
export class FolderFS implements WorkspaceFS {
  private readonly root: FileSystemDirectoryHandle
  private queue: Promise<unknown> = Promise.resolve()

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(() => fn())
    this.queue = p.catch(() => {})
    return p
  }

  private async ensureDirs(path: string): Promise<FileSystemDirectoryHandle> {
    let cur = this.root
    for (const seg of splitPath(path)) {
      try {
        cur = await cur.getDirectoryHandle(seg, { create: true })
      } catch (e) {
        mapDomException(e, 'dir')
      }
    }
    return cur
  }

  private async resolveDir(path: string): Promise<FileSystemDirectoryHandle> {
    if (path === '') return this.root
    let cur = this.root
    for (const seg of splitPath(path)) {
      try {
        cur = await cur.getDirectoryHandle(seg)
      } catch (e) {
        mapDomException(e, 'dir')
      }
    }
    return cur
  }

  private async resolveFile(path: string): Promise<FileSystemFileHandle> {
    if (path === '') throw new FSError('EISDIR', 'Is a directory: /')
    const parent = await this.resolveDir(dirname(path))
    const name = basename(path)
    try {
      return await parent.getFileHandle(name)
    } catch (e) {
      mapDomException(e, 'file')
    }
  }

  async list(dir: string, opts: { sizes?: boolean } = {}): Promise<Entry[]> {
    const p = normalizePath(dir)
    // Read-only, so it does not wait behind writes or the index's file reads.
    const d = await this.resolveDir(p)
    const out: Entry[] = []
    const stats: Promise<void>[] = []
    for await (const [name, h] of d.entries()) {
      const entry: Entry = { name, path: joinPath(p, name), kind: h.kind === 'file' ? 'file' : 'dir' }
      out.push(entry)
      if (h.kind === 'file' && opts.sizes !== false) {
        stats.push((async () => (entry.size = (await (h as FileSystemFileHandle).getFile()).size))().then(() => {}))
      }
    }
    await Promise.all(stats)
    return out.sort(compareEntries)
  }

  async listAll(onProgress?: (count: number) => void): Promise<Entry[]> {
    // Read-only and parallel, so it runs outside the write queue: opening a file or
    // reading for the index never waits behind a long walk.
    const entries = await walkInWorker(this.root, { onProgress })
    return depthFirst(entries)
  }

  async stat(path: string): Promise<Entry | null> {
    const p = normalizePath(path)
    return this.enqueue(async () => {
      if (p === '') return { name: '', path: '', kind: 'dir' }
      let parent: FileSystemDirectoryHandle
      try {
        parent = await this.resolveDir(dirname(p))
      } catch (e) {
        if (e instanceof FSError && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
          return null
        }
        throw e
      }
      const name = basename(p)
      try {
        const h = await parent.getFileHandle(name)
        const f = await h.getFile()
        return { name, path: p, kind: 'file', size: f.size }
      } catch (e) {
        if (e instanceof DOMException) {
          if (e.name === 'TypeMismatchError') {
            return { name, path: p, kind: 'dir' }
          }
          if (e.name === 'NotFoundError') {
            try {
              await parent.getDirectoryHandle(name)
              return { name, path: p, kind: 'dir' }
            } catch (e2) {
              if (e2 instanceof DOMException && e2.name === 'TypeMismatchError') {
                const h = await parent.getFileHandle(name)
                const f = await h.getFile()
                return { name, path: p, kind: 'file', size: f.size }
              }
              if (e2 instanceof DOMException && e2.name === 'NotFoundError') {
                return null
              }
              mapDomException(e2, 'dir')
            }
          }
        }
        throw e
      }
    })
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const p = normalizePath(path)
    return this.enqueue(async () => {
      const h = await this.resolveFile(p)
      const f = await h.getFile()
      return new Uint8Array(await f.arrayBuffer())
    })
  }

  async read(path: string): Promise<string> {
    return decodeText(await this.readBytes(path))
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
    await this.enqueue(async () => {
      const parent = await this.ensureDirs(dirname(p))
      const name = basename(p)
      let handle: FileSystemFileHandle
      try {
        handle = await parent.getFileHandle(name, { create: true })
      } catch (e) {
        mapDomException(e, 'file')
      }
      const writer = await handle.createWritable()
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

  async mkdir(path: string): Promise<void> {
    const p = normalizePath(path)
    await this.enqueue(async () => {
      await this.ensureDirs(p)
    })
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EINVAL', 'Cannot remove the workspace root')
    await this.enqueue(async () => {
      const parent = await this.resolveDir(dirname(p))
      const name = basename(p)
      try {
        await parent.removeEntry(name, { recursive: true })
      } catch (e) {
        mapDomException(e, 'dir')
      }
    })
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from)
    const dst = normalizePath(to)
    if (src === '' || dst === '') {
      throw new FSError('EINVAL', 'Cannot rename the root')
    }
    if (src === dst) return
    if (isWithin(dst, src)) {
      throw new FSError('EINVAL', 'Cannot move into itself')
    }
    await this.enqueue(async () => {
      const srcParent = await this.resolveDir(dirname(src))
      const srcName = basename(src)
      const dstParent = await this.ensureDirs(dirname(dst))
      const dstName = basename(dst)

      if (await this.exists(dstParent, dstName)) {
        throw new FSError('EEXIST', `Already exists: ${dst}`)
      }

      let srcHandle: FileSystemHandle
      let srcKind: 'file' | 'directory'
      try {
        srcHandle = await srcParent.getFileHandle(srcName)
        srcKind = 'file'
      } catch (e) {
        if (e instanceof DOMException && e.name === 'TypeMismatchError') {
          srcHandle = await srcParent.getDirectoryHandle(srcName)
          srcKind = 'directory'
        } else if (e instanceof DOMException && e.name === 'NotFoundError') {
          throw new FSError('ENOENT', `No such path: ${src}`)
        } else {
          mapDomException(e, 'file')
        }
      }

      const movable = srcHandle as Partial<{
        move(destination: FileSystemDirectoryHandle, name?: string): Promise<void>
      }>
      if (typeof movable.move === 'function') {
        try {
          await movable.move(dstParent, dstName)
          return
        } catch {
          /* fall back to copy/delete */
        }
      }

      await this.copyRecursive(srcHandle, srcKind, dstParent, dstName)
      await srcParent.removeEntry(srcName, { recursive: true })
    })
  }

  private async exists(
    parent: FileSystemDirectoryHandle,
    name: string,
  ): Promise<boolean> {
    try {
      await parent.getFileHandle(name)
      return true
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TypeMismatchError') {
        return true
      }
    }
    try {
      await parent.getDirectoryHandle(name)
      return true
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TypeMismatchError') {
        return true
      }
    }
    return false
  }

  private async copyRecursive(
    src: FileSystemHandle,
    kind: 'file' | 'directory',
    dstParent: FileSystemDirectoryHandle,
    dstName: string,
  ): Promise<void> {
    if (kind === 'file') {
      const srcFile = src as FileSystemFileHandle
      const dstFile = await dstParent.getFileHandle(dstName, { create: true })
      const data = new Uint8Array(await (await srcFile.getFile()).arrayBuffer())
      const writer = await dstFile.createWritable()
      await writer.write(data as BufferSource)
      await writer.close()
    } else {
      const srcDir = src as FileSystemDirectoryHandle
      const dstDir = await dstParent.getDirectoryHandle(dstName, { create: true })
      for await (const [name, h] of srcDir.entries()) {
        await this.copyRecursive(h, h.kind, dstDir, name)
      }
    }
  }
}
