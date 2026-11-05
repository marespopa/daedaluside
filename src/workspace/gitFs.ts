import { splitPath } from './path'

/**
 * A node-style `fs.promises` over a folder handle, in the shape isomorphic-git expects.
 * Paths are absolute (`/.git/HEAD`) with the folder as `/`. It walks the handle
 * directly, so `.git` is reachable here even though the workspace tree hides it.
 */

type Kind = 'file' | 'dir'

class GitFsError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'GitFsError'
    this.code = code
  }
}

const enoent = (p: string) =>
  new GitFsError('ENOENT', `no such file or directory, '${p}'`)

function mapError(e: unknown, path: string): never {
  if (e instanceof GitFsError) throw e
  if (e instanceof DOMException) {
    if (e.name === 'NotFoundError') throw enoent(path)
    if (e.name === 'TypeMismatchError') throw new GitFsError('ENOTDIR', path)
    if (e.name === 'InvalidModificationError') throw new GitFsError('ENOTEMPTY', path)
  }
  throw e
}

export interface GitStats {
  type: Kind
  mode: number
  size: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  uid: number
  gid: number
  dev: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

function stats(kind: Kind, size: number, mtimeMs: number): GitStats {
  return {
    type: kind,
    mode: kind === 'file' ? 0o100644 : 0o040000,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 0,
    gid: 0,
    dev: 0,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => false,
  }
}

type Data = Uint8Array | string
type Opts = { encoding?: string } | string | undefined

const wantsText = (o: Opts) => (typeof o === 'string' ? o : o?.encoding) !== undefined

export interface GitFs {
  promises: {
    readFile(path: string, opts?: Opts): Promise<Uint8Array | string>
    writeFile(path: string, data: Data, opts?: Opts): Promise<void>
    unlink(path: string): Promise<void>
    readdir(path: string): Promise<string[]>
    mkdir(path: string): Promise<void>
    rmdir(path: string): Promise<void>
    stat(path: string): Promise<GitStats>
    lstat(path: string): Promise<GitStats>
    readlink(path: string): Promise<string>
    symlink(target: string, path: string): Promise<void>
  }
}

export function createGitFs(root: FileSystemDirectoryHandle): GitFs {
  const segs = (p: string) =>
    splitPath(
      p
        .split('/')
        .filter((s) => s !== '' && s !== '.')
        .join('/'),
    )

  /** Directory handles by path, so deep paths are not re-walked from the root on every call. */
  const dirs = new Map<string, FileSystemDirectoryHandle>()

  async function dirOf(parts: string[], path: string, create = false) {
    let cur = root
    let key = ''
    try {
      for (const s of parts) {
        key = `${key}/${s}`
        const hit = dirs.get(key)
        if (hit) {
          cur = hit
          continue
        }
        cur = await cur.getDirectoryHandle(s, { create })
        dirs.set(key, cur)
      }
    } catch (e) {
      mapError(e, path)
    }
    return cur
  }

  /** The file or directory handle at `path`. */
  async function resolve(path: string) {
    const parts = segs(path)
    if (parts.length === 0) return { kind: 'dir' as const, dir: root }
    const parent = await dirOf(parts.slice(0, -1), path)
    const name = parts[parts.length - 1]!
    try {
      return { kind: 'file' as const, file: await parent.getFileHandle(name) }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'TypeMismatchError'))
        mapError(e, path)
    }
    try {
      return { kind: 'dir' as const, dir: await parent.getDirectoryHandle(name) }
    } catch (e) {
      return mapError(e, path)
    }
  }

  async function stat(path: string): Promise<GitStats> {
    const r = await resolve(path)
    if (r.kind === 'dir') return stats('dir', 0, 0)
    const f = (await r.file.getFile()) as { size: number; lastModified?: number }
    return stats('file', f.size, f.lastModified ?? 0)
  }

  return {
    promises: {
      async readFile(path, opts) {
        const r = await resolve(path)
        if (r.kind === 'dir') throw new GitFsError('EISDIR', path)
        const f = await r.file.getFile()
        const bytes = new Uint8Array(await f.arrayBuffer())
        return wantsText(opts) ? new TextDecoder().decode(bytes) : bytes
      },
      async writeFile(path, data) {
        const parts = segs(path)
        if (parts.length === 0) throw new GitFsError('EISDIR', path)
        const parent = await dirOf(parts.slice(0, -1), path, true)
        try {
          const h = await parent.getFileHandle(parts[parts.length - 1]!, { create: true })
          const w = await h.createWritable()
          await w.write(
            (typeof data === 'string'
              ? new TextEncoder().encode(data)
              : data) as BufferSource,
          )
          await w.close()
        } catch (e) {
          mapError(e, path)
        }
      },
      async unlink(path) {
        const parts = segs(path)
        const parent = await dirOf(parts.slice(0, -1), path)
        try {
          await parent.getFileHandle(parts[parts.length - 1]!)
          await parent.removeEntry(parts[parts.length - 1]!)
          dirs.clear()
        } catch (e) {
          mapError(e, path)
        }
      },
      async readdir(path) {
        const r = await resolve(path)
        if (r.kind === 'file') throw new GitFsError('ENOTDIR', path)
        const names: string[] = []
        for await (const [name] of r.dir.entries()) names.push(name)
        return names.sort()
      },
      async mkdir(path) {
        const parts = segs(path)
        if (parts.length === 0) throw new GitFsError('EEXIST', path)
        const parent = await dirOf(parts.slice(0, -1), path)
        const name = parts[parts.length - 1]!
        // Node's mkdir fails on an existing entry, and isomorphic-git relies on that.
        try {
          await parent.getDirectoryHandle(name)
          throw new GitFsError('EEXIST', path)
        } catch (e) {
          if (e instanceof GitFsError) throw e
          if (!(e instanceof DOMException && e.name === 'NotFoundError'))
            mapError(e, path)
        }
        try {
          await parent.getDirectoryHandle(name, { create: true })
        } catch (e) {
          mapError(e, path)
        }
      },
      async rmdir(path) {
        const parts = segs(path)
        const parent = await dirOf(parts.slice(0, -1), path)
        try {
          await parent.removeEntry(parts[parts.length - 1]!)
          dirs.clear()
        } catch (e) {
          mapError(e, path)
        }
      },
      stat,
      lstat: stat,
      readlink: (path) => Promise.reject(enoent(path)),
      symlink: (_target, path) => Promise.reject(new GitFsError('EPERM', path)),
    },
  }
}
