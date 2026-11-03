import {
  basename,
  compareEntries,
  decodeText,
  dirname,
  encodeText,
  isWithin,
  joinPath,
  normalizePath,
  splitPath,
  TMP_SUFFIX,
} from './path'
import { FSError, type Entry, type FSBackend, type WorkspaceFS } from './types'

type Dir = FileSystemDirectoryHandle
type File = FileSystemFileHandle

/** `move()` is not in every lib.dom version, and Safari/older browsers may lack it. */
interface Movable {
  move?: (dest: Dir, name: string) => Promise<void>
}

const errName = (e: unknown) => (e as { name?: string } | null)?.name

async function dirHandle(parent: Dir, name: string, create: boolean): Promise<Dir> {
  try {
    return await parent.getDirectoryHandle(name, { create })
  } catch (e) {
    if (errName(e) === 'NotFoundError')
      throw new FSError('ENOENT', `No such directory: ${name}`)
    if (errName(e) === 'TypeMismatchError')
      throw new FSError('ENOTDIR', `Not a directory: ${name}`)
    throw e
  }
}

async function fileHandle(parent: Dir, name: string, create: boolean): Promise<File> {
  try {
    return await parent.getFileHandle(name, { create })
  } catch (e) {
    if (errName(e) === 'NotFoundError')
      throw new FSError('ENOENT', `No such file: ${name}`)
    if (errName(e) === 'TypeMismatchError')
      throw new FSError('EISDIR', `Is a directory: ${name}`)
    throw e
  }
}

async function writeAll(file: File, data: Uint8Array): Promise<void> {
  const h = await file.createSyncAccessHandle()
  try {
    h.truncate(0)
    let at = 0
    while (at < data.byteLength) {
      const n = h.write(data.subarray(at), { at })
      if (n <= 0) throw new Error('Short write')
      at += n
    }
    h.flush()
  } finally {
    h.close()
  }
}

async function readAll(file: File): Promise<Uint8Array> {
  const h = await file.createSyncAccessHandle()
  try {
    const out = new Uint8Array(h.getSize())
    let at = 0
    while (at < out.byteLength) {
      const n = h.read(out.subarray(at), { at })
      if (n <= 0) break
      at += n
    }
    return at === out.byteLength ? out : out.slice(0, at)
  } finally {
    h.close()
  }
}

/**
 * One workspace on OPFS. Must run in a dedicated worker (sync access handles).
 * Operations are serialized: a sync handle takes an exclusive lock on its file.
 */
export class OpfsFS implements WorkspaceFS {
  private readonly getRoot: () => Promise<Dir>
  private rootP: Promise<Dir> | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(getRoot: () => Promise<Dir>) {
    this.getRoot = getRoot
  }

  private root(): Promise<Dir> {
    return (this.rootP ??= this.getRoot())
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async walk(path: string, create: boolean): Promise<Dir> {
    let dir = await this.root()
    for (const seg of splitPath(path)) dir = await dirHandle(dir, seg, create)
    return dir
  }

  private async statImpl(path: string): Promise<Entry | null> {
    if (path === '') return { name: '', path: '', kind: 'dir' }
    let parent: Dir
    try {
      parent = await this.walk(dirname(path), false)
    } catch (e) {
      if (e instanceof FSError && (e.code === 'ENOENT' || e.code === 'ENOTDIR'))
        return null
      throw e
    }
    const name = basename(path)
    try {
      const f = await parent.getFileHandle(name)
      return { name, path, kind: 'file', size: (await f.getFile()).size }
    } catch (e) {
      if (errName(e) !== 'NotFoundError' && errName(e) !== 'TypeMismatchError') throw e
    }
    try {
      await parent.getDirectoryHandle(name)
      return { name, path, kind: 'dir' }
    } catch (e) {
      if (errName(e) === 'NotFoundError' || errName(e) === 'TypeMismatchError')
        return null
      throw e
    }
  }

  /** Temp file + replace, so an interrupted write never leaves a truncated target. */
  private async writeAtomic(dir: Dir, name: string, data: Uint8Array): Promise<void> {
    try {
      await dir.getDirectoryHandle(name)
      throw new FSError('EISDIR', `Is a directory: ${name}`)
    } catch (e) {
      if (e instanceof FSError) throw e
      if (errName(e) !== 'NotFoundError' && errName(e) !== 'TypeMismatchError') throw e
    }
    const tmpName = name + TMP_SUFFIX
    const tmp = await fileHandle(dir, tmpName, true)
    try {
      await writeAll(tmp, data)
      const move = (tmp as Movable).move
      let moved = false
      if (typeof move === 'function') {
        try {
          await move.call(tmp, dir, name)
          moved = true
        } catch {
          /* fall through to copy */
        }
      }
      if (!moved) {
        // Temp content is already durable; copy it over the target.
        await writeAll(await fileHandle(dir, name, true), data)
        await dir.removeEntry(tmpName).catch(() => undefined)
      }
    } catch (e) {
      await dir.removeEntry(tmpName).catch(() => undefined)
      throw e
    }
  }

  list(dir: string): Promise<Entry[]> {
    return this.run(async () => {
      const path = normalizePath(dir)
      const handle = await this.walk(path, false)
      const out: Entry[] = []
      for await (const [name, h] of handle.entries()) {
        if (name.endsWith(TMP_SUFFIX)) continue
        const p = joinPath(path, name)
        if (h.kind === 'directory') out.push({ name, path: p, kind: 'dir' })
        else
          out.push({
            name,
            path: p,
            kind: 'file',
            size: (await (h as File).getFile()).size,
          })
      }
      return out.sort(compareEntries)
    })
  }

  listAll(): Promise<Entry[]> {
    return this.run(async () => {
      const out: Entry[] = []
      const visit = async (dir: Dir, prefix: string) => {
        const kids: { entry: Entry; handle?: Dir }[] = []
        for await (const [name, h] of dir.entries()) {
          if (name.endsWith(TMP_SUFFIX)) continue
          const p = joinPath(prefix, name)
          if (h.kind === 'directory')
            kids.push({ entry: { name, path: p, kind: 'dir' }, handle: h as Dir })
          else
            kids.push({
              entry: {
                name,
                path: p,
                kind: 'file',
                size: (await (h as File).getFile()).size,
              },
            })
        }
        kids.sort((a, b) => compareEntries(a.entry, b.entry))
        for (const { entry, handle } of kids) {
          out.push(entry)
          if (handle) await visit(handle, entry.path)
        }
      }
      await visit(await this.root(), '')
      return out
    })
  }

  stat(path: string): Promise<Entry | null> {
    return this.run(() => this.statImpl(normalizePath(path)))
  }

  readBytes(path: string): Promise<Uint8Array> {
    return this.run(async () => {
      const p = normalizePath(path)
      if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
      const parent = await this.walk(dirname(p), false)
      return readAll(await fileHandle(parent, basename(p), false))
    })
  }

  async read(path: string): Promise<string> {
    return decodeText(await this.readBytes(path))
  }

  writeBytes(path: string, data: Uint8Array): Promise<void> {
    return this.run(async () => {
      const p = normalizePath(path)
      if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
      const parent = await this.walk(dirname(p), true)
      await this.writeAtomic(parent, basename(p), data)
    })
  }

  write(path: string, content: string): Promise<void> {
    return this.writeBytes(path, encodeText(content))
  }

  mkdir(path: string): Promise<void> {
    return this.run(async () => {
      await this.walk(normalizePath(path), true)
    })
  }

  remove(path: string): Promise<void> {
    return this.run(async () => {
      const p = normalizePath(path)
      if (p === '') throw new FSError('EINVAL', 'Cannot remove the workspace root')
      const parent = await this.walk(dirname(p), false)
      try {
        await parent.removeEntry(basename(p), { recursive: true })
      } catch (e) {
        if (errName(e) === 'NotFoundError')
          throw new FSError('ENOENT', `No such path: ${p}`)
        throw e
      }
    })
  }

  rename(from: string, to: string): Promise<void> {
    return this.run(async () => {
      const src = normalizePath(from)
      const dst = normalizePath(to)
      if (src === '' || dst === '') throw new FSError('EINVAL', 'Cannot rename the root')
      const st = await this.statImpl(src)
      if (!st) throw new FSError('ENOENT', `No such path: ${src}`)
      if (src === dst) return
      if (isWithin(dst, src)) throw new FSError('EINVAL', 'Cannot move into itself')
      if (await this.statImpl(dst)) throw new FSError('EEXIST', `Already exists: ${dst}`)
      const srcParent = await this.walk(dirname(src), false)
      const dstParent = await this.walk(dirname(dst), true)
      const handle =
        st.kind === 'dir'
          ? await dirHandle(srcParent, basename(src), false)
          : await fileHandle(srcParent, basename(src), false)
      const move = (handle as Movable).move
      if (typeof move === 'function') {
        try {
          await move.call(handle, dstParent, basename(dst))
          return
        } catch {
          /* unsupported for this handle kind; copy instead */
        }
      }
      await this.copyTree(srcParent, basename(src), dstParent, basename(dst), st.kind)
      await srcParent.removeEntry(basename(src), { recursive: true })
    })
  }

  private async copyTree(
    srcParent: Dir,
    srcName: string,
    dstParent: Dir,
    dstName: string,
    kind: 'file' | 'dir',
  ): Promise<void> {
    if (kind === 'file') {
      const data = await readAll(await fileHandle(srcParent, srcName, false))
      await this.writeAtomic(dstParent, dstName, data)
      return
    }
    const s = await dirHandle(srcParent, srcName, false)
    const d = await dirHandle(dstParent, dstName, true)
    for await (const [name, h] of s.entries()) {
      if (name.endsWith(TMP_SUFFIX)) continue
      await this.copyTree(s, name, d, name, h.kind === 'directory' ? 'dir' : 'file')
    }
  }
}

export class OpfsBackend implements FSBackend {
  readonly kind = 'opfs'
  private readonly getRoot: () => Promise<Dir>

  constructor(getRoot: () => Promise<Dir>) {
    this.getRoot = getRoot
  }

  private workspaces(create: boolean): Promise<Dir> {
    return this.getRoot().then((r) => dirHandle(r, 'workspaces', create))
  }

  open(workspaceId: string): WorkspaceFS {
    normalizePath(workspaceId)
    return new OpfsFS(async () =>
      dirHandle(await this.workspaces(true), workspaceId, true),
    )
  }

  async destroy(workspaceId: string): Promise<void> {
    try {
      await (await this.workspaces(false)).removeEntry(workspaceId, { recursive: true })
    } catch (e) {
      if (errName(e) === 'NotFoundError') return
      if (e instanceof FSError && e.code === 'ENOENT') return
      throw e
    }
  }

  close(): void {}
}

/** Verifies sync access handles really work here (some private modes expose OPFS but fail). */
export async function probeOpfs(getRoot: () => Promise<Dir>): Promise<void> {
  const root = await getRoot()
  const name = `.probe-${Math.random().toString(36).slice(2)}`
  const f = await root.getFileHandle(name, { create: true })
  try {
    await writeAll(f, new Uint8Array([1]))
  } finally {
    await root.removeEntry(name).catch(() => undefined)
  }
}
