import { encodeText } from '../path'

function toUint8Array(data: BufferSource | Blob | string): Uint8Array {
  if (typeof data === 'string') return encodeText(data)
  if (data instanceof Blob) {
    throw new Error('Blob writes are not implemented in the memory OPFS stub')
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return new Uint8Array(data)
}

class MemFile {
  readonly kind = 'file' as const
  name: string
  private data: Uint8Array
  private closeShouldFail = false
  parent: MemDirectory | null = null

  constructor(
    name: string,
    data: Uint8Array,
    parent: MemDirectory | null,
    moveEnabled: boolean,
  ) {
    this.name = name
    this.data = data
    this.parent = parent
    if (moveEnabled) {
      this.move = async (destination: FileSystemDirectoryHandle, newName: string) => {
        this.doMove(destination, newName)
      }
    }
  }

  setCloseShouldFail(value: boolean): void {
    this.closeShouldFail = value
  }

  async getFile(): Promise<File> {
    return {
      name: this.name,
      size: this.data.byteLength,
      arrayBuffer: async () => this.data.slice().buffer,
    } as File
  }

  async createWritable(options?: {
    keepExistingData?: boolean
  }): Promise<FileSystemWritableFileStream> {
    const start = options?.keepExistingData ? this.data.slice() : new Uint8Array(0)
    const chunks: Uint8Array[] = [start]
    return {
      write: async (data: BufferSource | Blob | string) => {
        chunks.push(toUint8Array(data))
      },
      close: async () => {
        if (this.closeShouldFail) {
          this.closeShouldFail = false
          throw new DOMException('Close failed', 'NotAllowedError')
        }
        const size = chunks.reduce((n, c) => n + c.byteLength, 0)
        const out = new Uint8Array(size)
        let at = 0
        for (const c of chunks) {
          out.set(c, at)
          at += c.byteLength
        }
        this.data = out
      },
      abort: async () => {
        /* data is not committed until close() succeeds */
      },
    } as unknown as FileSystemWritableFileStream
  }

  move?: (destination: FileSystemDirectoryHandle, newName: string) => Promise<void>

  private doMove(destination: FileSystemDirectoryHandle, newName: string): void {
    if (this.parent) this.parent.children.delete(this.name)
    const dest = destination as unknown as MemDirectory
    dest.children.set(newName, this)
    this.parent = dest
    this.name = newName
  }
}

class MemDirectory {
  readonly kind = 'directory' as const
  name: string
  parent: MemDirectory | null = null
  readonly children = new Map<string, MemFile | MemDirectory>()
  private readonly moveEnabled: boolean

  constructor(name: string, parent: MemDirectory | null, moveEnabled: boolean) {
    this.name = name
    this.parent = parent
    this.moveEnabled = moveEnabled
    if (moveEnabled) {
      this.move = async (destination: FileSystemDirectoryHandle, newName: string) => {
        this.doMove(destination, newName)
      }
    }
  }

  async getDirectoryHandle(
    name: string,
    opts: { create?: boolean } = {},
  ): Promise<FileSystemDirectoryHandle> {
    const child = this.children.get(name)
    if (child) {
      if (child.kind !== 'directory') {
        throw new DOMException('Not a directory', 'TypeMismatchError')
      }
      return child as unknown as FileSystemDirectoryHandle
    }
    if (!opts.create) throw new DOMException('No such entry', 'NotFoundError')
    const dir = new MemDirectory(name, this, this.moveEnabled)
    this.children.set(name, dir)
    return dir as unknown as FileSystemDirectoryHandle
  }

  async getFileHandle(
    name: string,
    opts: { create?: boolean } = {},
  ): Promise<FileSystemFileHandle> {
    const child = this.children.get(name)
    if (child) {
      if (child.kind !== 'file') {
        throw new DOMException('Not a file', 'TypeMismatchError')
      }
      return child as unknown as FileSystemFileHandle
    }
    if (!opts.create) throw new DOMException('No such entry', 'NotFoundError')
    const file = new MemFile(name, new Uint8Array(), this, this.moveEnabled)
    this.children.set(name, file)
    return file as unknown as FileSystemFileHandle
  }

  async removeEntry(name: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const child = this.children.get(name)
    if (!child) throw new DOMException('No such entry', 'NotFoundError')
    if (child.kind === 'directory' && !opts.recursive && child.children.size > 0) {
      throw new DOMException('Directory not empty', 'InvalidModificationError')
    }
    this.children.delete(name)
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    const sorted = [...this.children.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    for (const [name, child] of sorted) {
      child.parent = this
      yield [name, child as unknown as FileSystemHandle]
    }
  }

  move?: (destination: FileSystemDirectoryHandle, newName: string) => Promise<void>

  private doMove(destination: FileSystemDirectoryHandle, newName: string): void {
    if (this.parent) this.parent.children.delete(this.name)
    const dest = destination as unknown as MemDirectory
    dest.children.set(newName, this)
    this.parent = dest
    this.name = newName
  }
}

export class MemRoot extends MemDirectory {
  constructor(moveEnabled: boolean) {
    super('', null, moveEnabled)
  }

  rootHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle
  }

  async breakFile(path: string): Promise<void> {
    const parts = path.split('/').filter((p) => p !== '')
    const name = parts.pop()
    if (!name) throw new Error('Empty path')
    const dir = await parts.reduce<Promise<MemDirectory>>(
      async (promise, part) => {
        const parent = await promise
        return (await parent.getDirectoryHandle(part)) as unknown as MemDirectory
      },
      Promise.resolve(this as unknown as MemDirectory),
    )
    const file = (await dir.getFileHandle(name)) as unknown as MemFile
    file.setCloseShouldFail(true)
  }
}

export function createMemoryOpfs(opts: { moveEnabled?: boolean } = {}): MemRoot {
  return new MemRoot(opts.moveEnabled ?? true)
}
