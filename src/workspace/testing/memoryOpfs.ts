/**
 * In-memory stand-in for the OPFS handle API (subset used by OpfsFS), including
 * exclusive sync access handles, so the worker logic can be tested in Node.
 */
const err = (name: string, msg = name) => new DOMException(msg, name)

class MemFile {
  data = new Uint8Array(0)
  locked = false
}

class MemSyncHandle {
  private readonly f: MemFile
  private closed = false
  constructor(f: MemFile) {
    this.f = f
  }
  private check() {
    if (this.closed) throw err('InvalidStateError')
  }
  getSize() {
    this.check()
    return this.f.data.byteLength
  }
  read(buf: Uint8Array, opts?: { at?: number }) {
    this.check()
    const at = opts?.at ?? 0
    const n = Math.max(0, Math.min(buf.byteLength, this.f.data.byteLength - at))
    buf.set(this.f.data.subarray(at, at + n))
    return n
  }
  write(buf: Uint8Array, opts?: { at?: number }) {
    this.check()
    const at = opts?.at ?? 0
    if (at + buf.byteLength > this.f.data.byteLength) {
      const next = new Uint8Array(at + buf.byteLength)
      next.set(this.f.data)
      this.f.data = next
    }
    this.f.data.set(buf, at)
    return buf.byteLength
  }
  truncate(size: number) {
    this.check()
    const next = new Uint8Array(size)
    next.set(this.f.data.subarray(0, size))
    this.f.data = next
  }
  flush() {
    this.check()
  }
  close() {
    this.closed = true
    this.f.locked = false
  }
}

type Node = MemFile | MemDirData
type MemDirData = Map<string, Node>

export interface MemOptions {
  /** When false, handles have no `move()` so the copy fallback is exercised. */
  supportsMove?: boolean
}

class MemFileHandle {
  readonly kind = 'file'
  name: string
  private parent: MemDirData
  constructor(name: string, parent: MemDirData, opts: MemOptions) {
    this.name = name
    this.parent = parent
    if (opts.supportsMove !== false) {
      ;(this as unknown as { move: unknown }).move = (
        dest: MemDirHandle,
        newName: string,
      ) => moveNode(this.parent, this.name, dest.data, newName)
    }
  }
  private file(): MemFile {
    const f = this.parent.get(this.name)
    if (!(f instanceof MemFile)) throw err('NotFoundError')
    return f
  }
  async createSyncAccessHandle() {
    const f = this.file()
    if (f.locked) throw err('NoModificationAllowedError')
    f.locked = true
    return new MemSyncHandle(f)
  }
  async getFile() {
    return { size: this.file().data.byteLength }
  }
}

function moveNode(from: MemDirData, name: string, to: MemDirData, newName: string) {
  const node = from.get(name)
  if (!node) throw err('NotFoundError')
  if (node instanceof MemFile && node.locked) throw err('NoModificationAllowedError')
  from.delete(name)
  to.set(newName, node)
  return Promise.resolve()
}

export class MemDirHandle {
  readonly kind = 'directory'
  readonly data: MemDirData
  readonly name: string
  private readonly opts: MemOptions
  constructor(
    name = '',
    data: MemDirData = new Map(),
    opts: MemOptions = {},
    parent?: MemDirData,
  ) {
    this.name = name
    this.data = data
    this.opts = opts
    if (opts.supportsMove !== false && parent) {
      ;(this as unknown as { move: unknown }).move = (
        dest: MemDirHandle,
        newName: string,
      ) => moveNode(parent, this.name, dest.data, newName)
    }
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    let n = this.data.get(name)
    if (!n) {
      if (!o?.create) throw err('NotFoundError')
      this.data.set(name, (n = new Map()))
    }
    if (n instanceof MemFile) throw err('TypeMismatchError')
    return new MemDirHandle(name, n, this.opts, this.data)
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    let n = this.data.get(name)
    if (!n) {
      if (!o?.create) throw err('NotFoundError')
      this.data.set(name, (n = new MemFile()))
    }
    if (!(n instanceof MemFile)) throw err('TypeMismatchError')
    return new MemFileHandle(name, this.data, this.opts)
  }
  async removeEntry(name: string, o?: { recursive?: boolean }) {
    const n = this.data.get(name)
    if (!n) throw err('NotFoundError')
    if (n instanceof Map && n.size > 0 && !o?.recursive)
      throw err('InvalidModificationError')
    this.data.delete(name)
  }
  async *entries(): AsyncGenerator<[string, MemDirHandle | MemFileHandle]> {
    for (const [name, n] of [...this.data]) {
      yield [
        name,
        n instanceof MemFile
          ? new MemFileHandle(name, this.data, this.opts)
          : new MemDirHandle(name, n, this.opts, this.data),
      ]
    }
  }
}

export const memoryRoot = (opts: MemOptions = {}) =>
  new MemDirHandle('', new Map(), opts) as unknown as FileSystemDirectoryHandle
