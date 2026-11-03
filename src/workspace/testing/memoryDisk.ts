/**
 * In-memory stand-in for a FileSystemDirectoryHandle, enough for DiskMirror, the folder
 * picker's import walk, and permission checks. Tests can flip `access` to simulate a
 * lost grant.
 */

export type Access = 'granted' | 'prompt' | 'denied'

function notFound(name: string): DOMException {
  return new DOMException(`No such entry: ${name}`, 'NotFoundError')
}

class MemFile {
  readonly kind = 'file' as const
  readonly name: string
  private readonly disk: MemDisk
  private readonly data: Map<string, Uint8Array>
  private readonly path: string

  constructor(name: string, disk: MemDisk, data: Map<string, Uint8Array>, path: string) {
    this.name = name
    this.disk = disk
    this.data = data
    this.path = path
  }

  /** Shaped like a File for what the folder walk reads (jsdom's Blob has no arrayBuffer). */
  async getFile() {
    const bytes = this.data.get(this.path) ?? new Uint8Array()
    return { name: this.name, arrayBuffer: async () => bytes.slice().buffer }
  }

  async createWritable() {
    this.disk.assertAccess()
    const path = this.path
    const data = this.data
    let chunks: Uint8Array[] = []
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
        data.set(path, out)
        chunks = []
      },
    }
  }
}

export class MemDisk {
  /** Files by path, and folders by path ('' is the root). */
  readonly files = new Map<string, Uint8Array>()
  readonly dirs = new Set<string>([''])
  access: Access = 'granted'

  assertAccess() {
    if (this.access !== 'granted')
      throw new DOMException('Permission was not granted', 'NotAllowedError')
  }

  handle(name = 'proj'): MemDirectory {
    return new MemDirectory(this, '', name)
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

  async queryPermission(): Promise<PermissionState> {
    return this.disk.access === 'granted' ? 'granted' : 'prompt'
  }

  async requestPermission(): Promise<PermissionState> {
    if (this.disk.access === 'prompt') this.disk.access = 'granted'
    return this.disk.access === 'granted' ? 'granted' : 'denied'
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    const p = this.child(name)
    if (!this.disk.dirs.has(p)) {
      if (!opts.create) throw notFound(name)
      this.disk.assertAccess()
      this.disk.dirs.add(p)
    }
    return new MemDirectory(this.disk, p, name)
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    const p = this.child(name)
    if (!this.disk.files.has(p)) {
      if (!opts.create) throw notFound(name)
      this.disk.assertAccess()
      this.disk.files.set(p, new Uint8Array())
    }
    return new MemFile(name, this.disk, this.disk.files, p)
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
      if (!rest.includes('/'))
        names.set(rest, new MemFile(rest, this.disk, this.disk.files, f))
    }
    for (const d of this.disk.dirs) {
      if (d === '' || !d.startsWith(prefix)) continue
      const rest = d.slice(prefix.length)
      if (!rest.includes('/')) names.set(rest, new MemDirectory(this.disk, d, rest))
    }
    for (const entry of names) yield entry
  }
}
