import { done, wrap } from './db'
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
import { FSError, type Entry, type FSBackend, type WorkspaceFS } from './types'

const STORE = 'fs-fallback'

interface Rec {
  kind: 'file' | 'dir'
  data?: Uint8Array
  mtime: number
}

const keyOf = (ws: string, path: string) => `${ws}:${path}`
/** All keys strictly below `path` (not `path` itself). */
const below = (ws: string, path: string) => {
  const prefix = path === '' ? `${ws}:` : `${ws}:${path}/`
  return IDBKeyRange.bound(prefix, prefix + '\uffff')
}

/** One workspace stored as `workspaceId:path` records in IndexedDB. Used when OPFS is unavailable. */
export class IdbFS implements WorkspaceFS {
  private readonly db: IDBDatabase
  private readonly ws: string

  constructor(db: IDBDatabase, ws: string) {
    this.db = db
    this.ws = ws
  }

  private async withTx<T>(
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const tx = this.db.transaction(STORE, mode)
    const committed = done(tx)
    committed.catch(() => undefined)
    let result: T
    try {
      result = await fn(tx.objectStore(STORE))
    } catch (e) {
      try {
        tx.abort()
      } catch {
        /* already finished */
      }
      throw e
    }
    await committed
    return result
  }

  private async get(s: IDBObjectStore, path: string): Promise<Rec | undefined> {
    return (await wrap(s.get(keyOf(this.ws, path)))) as Rec | undefined
  }

  /** Requires `path` to be an existing directory (the root always is). */
  private async requireDir(s: IDBObjectStore, path: string): Promise<void> {
    if (path === '') return
    const r = await this.get(s, path)
    if (!r) throw new FSError('ENOENT', `No such directory: ${path}`)
    if (r.kind !== 'dir') throw new FSError('ENOTDIR', `Not a directory: ${path}`)
  }

  /** mkdir -p. */
  private async ensureDirs(s: IDBObjectStore, path: string): Promise<void> {
    let cur = ''
    for (const seg of splitPath(path)) {
      cur = joinPath(cur, seg)
      const r = await this.get(s, cur)
      if (!r)
        await wrap(
          s.put({ kind: 'dir', mtime: Date.now() } satisfies Rec, keyOf(this.ws, cur)),
        )
      else if (r.kind !== 'dir') throw new FSError('ENOTDIR', `Not a directory: ${cur}`)
    }
  }

  private async cursorAll(
    s: IDBObjectStore,
    range: IDBKeyRange,
  ): Promise<{ key: string; rec: Rec }[]> {
    const out: { key: string; rec: Rec }[] = []
    await new Promise<void>((resolve, reject) => {
      const req = s.openCursor(range)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve()
        out.push({ key: c.key as string, rec: c.value as Rec })
        c.continue()
      }
    })
    return out
  }

  async list(dir: string): Promise<Entry[]> {
    const path = normalizePath(dir)
    return await this.withTx('readonly', async (s) => {
      await this.requireDir(s, path)
      const prefixLen = keyOf(this.ws, path === '' ? '' : path + '/').length
      const out: Entry[] = []
      for (const { key, rec } of await this.cursorAll(s, below(this.ws, path))) {
        const rest = key.slice(prefixLen)
        if (rest.includes('/')) continue
        const p = joinPath(path, rest)
        out.push(
          rec.kind === 'dir'
            ? { name: rest, path: p, kind: 'dir' }
            : { name: rest, path: p, kind: 'file', size: rec.data?.byteLength ?? 0 },
        )
      }
      return out.sort(compareEntries)
    })
  }

  async listAll(): Promise<Entry[]> {
    const prefixLen = keyOf(this.ws, '').length
    return await this.withTx('readonly', async (s) => {
      const out: Entry[] = []
      // One range scan over the workspace instead of one scan per directory.
      for (const { key, rec } of await this.cursorAll(s, below(this.ws, ''))) {
        const p = key.slice(prefixLen)
        const name = basename(p)
        out.push(
          rec.kind === 'dir'
            ? { name, path: p, kind: 'dir' }
            : { name, path: p, kind: 'file', size: rec.data?.byteLength ?? 0 },
        )
      }
      return depthFirst(out)
    })
  }

  async stat(path: string): Promise<Entry | null> {
    const p = normalizePath(path)
    if (p === '') return { name: '', path: '', kind: 'dir' }
    return await this.withTx('readonly', async (s) => {
      const r = await this.get(s, p)
      if (!r) return null
      const name = basename(p)
      return r.kind === 'dir'
        ? { name, path: p, kind: 'dir' }
        : { name, path: p, kind: 'file', size: r.data?.byteLength ?? 0 }
    })
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
    return await this.withTx('readonly', async (s) => {
      const r = await this.get(s, p)
      if (!r) throw new FSError('ENOENT', `No such file: ${p}`)
      if (r.kind === 'dir') throw new FSError('EISDIR', `Is a directory: ${p}`)
      return r.data ?? new Uint8Array(0)
    })
  }

  async read(path: string): Promise<string> {
    return decodeText(await this.readBytes(path))
  }

  /** A single IDB put is already atomic, so no temp file is needed here. */
  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
    return await this.withTx('readwrite', async (s) => {
      const existing = await this.get(s, p)
      if (existing?.kind === 'dir') throw new FSError('EISDIR', `Is a directory: ${p}`)
      await this.ensureDirs(s, dirname(p))
      await wrap(
        s.put(
          { kind: 'file', data: data.slice(), mtime: Date.now() } satisfies Rec,
          keyOf(this.ws, p),
        ),
      )
    })
  }

  write(path: string, content: string): Promise<void> {
    return this.writeBytes(path, encodeText(content))
  }

  async mkdir(path: string): Promise<void> {
    const p = normalizePath(path)
    return await this.withTx('readwrite', (s) => this.ensureDirs(s, p))
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EINVAL', 'Cannot remove the workspace root')
    return await this.withTx('readwrite', async (s) => {
      if (!(await this.get(s, p))) throw new FSError('ENOENT', `No such path: ${p}`)
      await wrap(s.delete(below(this.ws, p)))
      await wrap(s.delete(keyOf(this.ws, p)))
    })
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from)
    const dst = normalizePath(to)
    if (src === '' || dst === '') throw new FSError('EINVAL', 'Cannot rename the root')
    return await this.withTx('readwrite', async (s) => {
      const rec = await this.get(s, src)
      if (!rec) throw new FSError('ENOENT', `No such path: ${src}`)
      if (src === dst) return
      if (isWithin(dst, src)) throw new FSError('EINVAL', 'Cannot move into itself')
      if (await this.get(s, dst)) throw new FSError('EEXIST', `Already exists: ${dst}`)
      await this.ensureDirs(s, dirname(dst))
      const moved = [
        { key: keyOf(this.ws, src), rec },
        ...(rec.kind === 'dir' ? await this.cursorAll(s, below(this.ws, src)) : []),
      ]
      const oldPrefix = keyOf(this.ws, src)
      for (const m of moved) {
        await wrap(s.put(m.rec, keyOf(this.ws, dst) + m.key.slice(oldPrefix.length)))
      }
      await wrap(s.delete(below(this.ws, src)))
      await wrap(s.delete(keyOf(this.ws, src)))
    })
  }
}

export class IdbBackend implements FSBackend {
  readonly kind = 'idb'
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  open(workspaceId: string): WorkspaceFS {
    if (workspaceId === '' || workspaceId.includes(':') || workspaceId.includes('/'))
      throw new FSError('EINVAL', 'Invalid workspace id')
    return new IdbFS(this.db, workspaceId)
  }

  async destroy(workspaceId: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite')
    const prefix = `${workspaceId}:`
    tx.objectStore(STORE).delete(IDBKeyRange.bound(prefix, prefix + '\uffff'))
    await done(tx)
  }

  close(): void {}
}
