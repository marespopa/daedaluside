/**
 * In-memory stand-in for a FileSystemDirectoryHandle. Tests can flip `access` to
 * simulate a lost grant; `'readonly'` models a handle whose read still works while
 * readwrite is no longer granted.
 */

import { dirname } from '../path'

export type Access = 'granted' | 'readonly' | 'prompt' | 'denied'

function notFound(name: string): DOMException {
  return new DOMException(`No such entry: ${name}`, 'NotFoundError')
}

/** A File-like view of `disk.files` at `path` (jsdom's Blob has no arrayBuffer). */
function fileView(disk: MemDisk, name: string, path: string) {
  const bytes = disk.files.get(path) ?? new Uint8Array()
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

/**
 * A writable like the API's: `write` buffers, `close` replaces the file whole (so a
 * shorter overwrite leaves no stale tail), and `abort` discards everything.
 */
function createMemWritable(disk: MemDisk, path: string) {
  disk.assertAccess()
  let chunks: Uint8Array[] = []
  let aborted = false
  return {
    write: async (d: BufferSource) => {
      chunks.push(
        d instanceof ArrayBuffer
          ? new Uint8Array(d)
          : new Uint8Array(d.buffer, d.byteOffset, d.byteLength),
      )
    },
    close: async () => {
      const size = chunks.reduce((n, c) => n + c.byteLength, 0)
      const out = new Uint8Array(size)
      let at = 0
      for (const c of chunks) {
        out.set(c, at)
        at += c.byteLength
      }
      chunks = []
      if (aborted) return
      if (disk.brokenFiles.has(path)) {
        disk.brokenFiles.delete(path)
        throw new DOMException('Close failed', 'NotAllowedError')
      }
      disk.files.set(path, out)
    },
    abort: async () => {
      aborted = true
    },
  }
}

class MemFile {
  readonly kind = 'file' as const
  readonly name: string
  private readonly disk: MemDisk
  private readonly path: string

  constructor(name: string, disk: MemDisk, path: string) {
    this.name = name
    this.disk = disk
    this.path = path
  }

  async getFile() {
    this.disk.assertRead()
    return fileView(this.disk, this.name, this.path)
  }

  async createWritable() {
    return createMemWritable(this.disk, this.path)
  }
}

/**
 * A permissioned file handle: the shape `showOpenFilePicker()` resolves to. Backs
 * `SingleFileFS` tests. `disk.access` simulates the grant expiring or returning.
 */
export class MemFileHandle {
  readonly kind = 'file' as const
  readonly name: string
  private readonly disk: MemDisk
  private readonly path: string

  constructor(disk: MemDisk, path: string, name: string) {
    this.disk = disk
    this.path = path
    this.name = name
  }

  /** The API checks the grant before returning a File; reads fail when it lapsed. */
  async getFile() {
    this.disk.assertRead()
    return fileView(this.disk, this.name, this.path)
  }

  async createWritable() {
    return createMemWritable(this.disk, this.path)
  }

  /** Readwrite only: `'readonly'` reports `'prompt'` while its reads keep working. */
  async queryPermission(): Promise<PermissionState> {
    return this.disk.canWrite() ? 'granted' : 'prompt'
  }

  async requestPermission(): Promise<PermissionState> {
    if (this.disk.access === 'prompt') this.disk.access = 'granted'
    return this.disk.canWrite() ? 'granted' : 'denied'
  }
}

export class MemDisk {
  /** Files by path, and folders by path ('' is the root). */
  readonly files = new Map<string, Uint8Array>()
  readonly dirs = new Set<string>([''])
  readonly brokenFiles = new Set<string>()
  access: Access = 'granted'

  /** Reads work with a full or a read-only grant; the rest need a click. */
  canRead(): boolean {
    return this.access === 'granted' || this.access === 'readonly'
  }

  canWrite(): boolean {
    return this.access === 'granted'
  }

  /** Thrown by reads when even reading is not allowed (`prompt`/`denied`). */
  assertRead() {
    if (!this.canRead())
      throw new DOMException('Permission was not granted', 'NotAllowedError')
  }

  assertAccess() {
    if (!this.canWrite())
      throw new DOMException('Permission was not granted', 'NotAllowedError')
  }

  handle(name = 'proj'): MemDirectory {
    return new MemDirectory(this, '', name)
  }

  /**
   * A stand-in for the file handle behind a single-file workspace: `name` at the root
   * of this disk, with the same permission methods the directory handle has.
   */
  fileHandle(name = 'notes.md', data: Uint8Array = new Uint8Array()): MemFileHandle {
    if (!this.files.has(name)) this.files.set(name, data)
    return new MemFileHandle(this, name, name)
  }

  breakFile(path: string): void {
    this.brokenFiles.add(path)
  }

  /** Stores a file and ensures every parent directory is tracked. */
  setFile(path: string, data: Uint8Array): void {
    this.files.set(path, data)
    for (let dir = dirname(path); dir !== ''; dir = dirname(dir)) this.dirs.add(dir)
  }
}

export class MemDirectory {
  readonly kind = 'directory' as const
  readonly name: string
  private readonly disk: MemDisk
  private readonly path: string

  constructor(disk: MemDisk, path: string, name: string) {
    this.disk = disk
    this.path = path
    this.name = name
  }

  private child(name: string) {
    return this.path === '' ? name : `${this.path}/${name}`
  }

  /** Readwrite only: `'readonly'` reports `'prompt'` while its reads keep working. */
  async queryPermission(): Promise<PermissionState> {
    return this.disk.canWrite() ? 'granted' : 'prompt'
  }

  async requestPermission(): Promise<PermissionState> {
    if (this.disk.access === 'prompt') this.disk.access = 'granted'
    return this.disk.canWrite() ? 'granted' : 'denied'
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    const p = this.child(name)
    if (this.disk.files.has(p)) {
      throw new DOMException('Not a directory', 'TypeMismatchError')
    }
    if (!this.disk.dirs.has(p)) {
      if (!opts.create) throw notFound(name)
      this.disk.assertAccess()
      this.disk.dirs.add(p)
    }
    return new MemDirectory(this.disk, p, name)
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    const p = this.child(name)
    if (this.disk.dirs.has(p)) {
      throw new DOMException('Not a file', 'TypeMismatchError')
    }
    if (!this.disk.files.has(p)) {
      if (!opts.create) throw notFound(name)
      this.disk.assertAccess()
      this.disk.files.set(p, new Uint8Array())
    }
    return new MemFile(name, this.disk, p)
  }

  async removeEntry(name: string, opts: { recursive?: boolean } = {}) {
    this.disk.assertAccess()
    const p = this.child(name)
    if (this.disk.files.delete(p)) return
    if (!this.disk.dirs.has(p)) throw notFound(name)
    const inside = (q: string) => q.startsWith(`${p}/`)
    if (!opts.recursive && [...this.disk.files.keys(), ...this.disk.dirs].some(inside))
      throw new DOMException('Folder is not empty', 'InvalidModificationError')
    for (const f of [...this.disk.files.keys()])
      if (f === p || inside(f)) this.disk.files.delete(f)
    for (const d of [...this.disk.dirs])
      if (d === p || inside(d)) this.disk.dirs.delete(d)
  }

  /** Entries of this folder, as the picker's async iterator yields them. */
  async *entries(): AsyncGenerator<[string, MemFile | MemDirectory]> {
    const prefix = this.path === '' ? '' : `${this.path}/`
    const names = new Map<string, MemFile | MemDirectory>()
    for (const f of this.disk.files.keys()) {
      if (!f.startsWith(prefix)) continue
      const rest = f.slice(prefix.length)
      if (!rest.includes('/')) names.set(rest, new MemFile(rest, this.disk, f))
    }
    for (const d of this.disk.dirs) {
      if (d === '' || !d.startsWith(prefix)) continue
      const rest = d.slice(prefix.length)
      if (!rest.includes('/')) names.set(rest, new MemDirectory(this.disk, d, rest))
    }
    for (const entry of names) yield entry
  }
}
