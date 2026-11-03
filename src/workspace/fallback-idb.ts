import {
  BY_PARENT,
  done,
  FS_BLOB,
  FS_META,
  linkKey,
  SETTINGS,
  wrap,
  WORKSPACES,
} from './db'
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
import {
  FSError,
  type Entry,
  type FSBackend,
  type OpenOptions,
  type WorkspaceFS,
} from './types'

/** Parent id of top-level entries. The workspace root has no record. */
const ROOT = ''

/**
 * One file or folder. Records refer to their parent by id, so renaming or moving a
 * folder changes one record, not every path below it.
 */
interface FsNode {
  id: string
  ws: string
  parent: string
  name: string
  kind: 'file' | 'dir'
  size?: number
  mtime: number
}

type Stores = { meta: IDBObjectStore; blob: IDBObjectStore; workspaces: IDBObjectStore }

const nodeKey = (ws: string, id: string) => `${ws}:${id}`
/** Every node of a workspace. Keys are `ws:id`; the `:` keeps `app` and `app2` apart. */
const wsRange = (ws: string) => IDBKeyRange.bound(`${ws}:`, `${ws}:\uffff`)
/** Index range of the children of one folder. */
const childRange = (ws: string, parent: string) =>
  IDBKeyRange.bound([ws, parent], [ws, parent, []])

const rootNode = (ws: string): FsNode => ({
  id: ROOT,
  ws,
  parent: ROOT,
  name: '',
  kind: 'dir',
  mtime: 0,
})

const entryOf = (parentPath: string, n: FsNode): Entry =>
  n.kind === 'dir'
    ? { name: n.name, path: joinPath(parentPath, n.name), kind: 'dir' }
    : { name: n.name, path: joinPath(parentPath, n.name), kind: 'file', size: n.size ?? 0 }

/** Reads every value a cursor visits. */
function cursorValues<V>(
  source: IDBObjectStore | IDBIndex,
  range: IDBKeyRange,
): Promise<V[]> {
  return new Promise<V[]>((resolve, reject) => {
    const out: V[] = []
    const req = source.openCursor(range)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const c = req.result
      if (!c) return resolve(out)
      out.push(c.value as V)
      c.continue()
    }
  })
}

/**
 * One workspace in IndexedDB. Each file or folder is a node record (metadata, no bytes)
 * plus, for files, a byte record. A write touches both in one transaction, and checks
 * that the workspace still exists, so readers in other tabs see old or new, never a mix.
 */
export class IdbFS implements WorkspaceFS {
  private readonly db: IDBDatabase
  private readonly ws: string
  private readonly requireWorkspace: boolean

  constructor(db: IDBDatabase, ws: string, requireWorkspace = false) {
    this.db = db
    this.ws = ws
    this.requireWorkspace = requireWorkspace
  }

  private async withTx<T>(
    mode: IDBTransactionMode,
    fn: (s: Stores) => Promise<T>,
  ): Promise<T> {
    const tx = this.db.transaction([FS_META, FS_BLOB, WORKSPACES], mode)
    const committed = done(tx)
    committed.catch(() => undefined)
    let result: T
    try {
      result = await fn({
        meta: tx.objectStore(FS_META),
        blob: tx.objectStore(FS_BLOB),
        workspaces: tx.objectStore(WORKSPACES),
      })
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

  /** Throws if the workspace record is gone. Runs inside the write's transaction. */
  private async requireLive(s: Stores): Promise<void> {
    if (!this.requireWorkspace) return
    if (!(await wrap(s.workspaces.get(this.ws))))
      throw new FSError('ENOENT', 'This workspace was deleted')
  }

  private child(s: Stores, parent: string, name: string): Promise<FsNode | undefined> {
    return wrap(s.meta.index(BY_PARENT).get([this.ws, parent, name])) as Promise<
      FsNode | undefined
    >
  }

  private children(s: Stores, parent: string): Promise<FsNode[]> {
    return cursorValues<FsNode>(s.meta.index(BY_PARENT), childRange(this.ws, parent))
  }

  /** The node at `path`, or undefined if any segment is missing or not a folder. */
  private async resolve(s: Stores, path: string): Promise<FsNode | undefined> {
    let cur = rootNode(this.ws)
    for (const seg of splitPath(path)) {
      if (cur.kind !== 'dir') return undefined
      const next = await this.child(s, cur.id, seg)
      if (!next) return undefined
      cur = next
    }
    return cur
  }

  /** mkdir -p. Returns the id of the folder at `path`. */
  private async ensureDirs(s: Stores, path: string): Promise<string> {
    let cur = ROOT
    let soFar = ''
    for (const seg of splitPath(path)) {
      soFar = joinPath(soFar, seg)
      const n = await this.child(s, cur, seg)
      if (!n) {
        const id = crypto.randomUUID()
        const node: FsNode = {
          id,
          ws: this.ws,
          parent: cur,
          name: seg,
          kind: 'dir',
          mtime: Date.now(),
        }
        await wrap(s.meta.put(node, nodeKey(this.ws, id)))
        cur = id
      } else if (n.kind !== 'dir') {
        throw new FSError('ENOTDIR', `Not a directory: ${soFar}`)
      } else {
        cur = n.id
      }
    }
    return cur
  }

  async list(dir: string): Promise<Entry[]> {
    const path = normalizePath(dir)
    return await this.withTx('readonly', async (s) => {
      const r = await this.resolve(s, path)
      if (!r) throw new FSError('ENOENT', `No such directory: ${path}`)
      if (r.kind !== 'dir') throw new FSError('ENOTDIR', `Not a directory: ${path}`)
      const kids = await this.children(s, r.id)
      return kids.map((n) => entryOf(path, n)).sort(compareEntries)
    })
  }

  async listAll(): Promise<Entry[]> {
    return await this.withTx('readonly', async (s) => {
      // Metadata only: no file bytes are read to list a tree.
      const nodes = await cursorValues<FsNode>(s.meta, wsRange(this.ws))
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const pathOf = (n: FsNode): string => {
        const parts: string[] = []
        for (let cur: FsNode | undefined = n; cur; cur = byId.get(cur.parent))
          parts.unshift(cur.name)
        return parts.join('/')
      }
      const entries = nodes.map((n): Entry => {
        const path = pathOf(n)
        return n.kind === 'dir'
          ? { name: n.name, path, kind: 'dir' }
          : { name: n.name, path, kind: 'file', size: n.size ?? 0 }
      })
      return depthFirst(entries)
    })
  }

  async stat(path: string): Promise<Entry | null> {
    const p = normalizePath(path)
    return await this.withTx('readonly', async (s) => {
      const r = await this.resolve(s, p)
      if (!r) return null
      if (p === '') return { name: '', path: '', kind: 'dir' }
      return r.kind === 'dir'
        ? { name: r.name, path: p, kind: 'dir' }
        : { name: r.name, path: p, kind: 'file', size: r.size ?? 0 }
    })
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
    return await this.withTx('readonly', async (s) => {
      const r = await this.resolve(s, p)
      if (!r) throw new FSError('ENOENT', `No such file: ${p}`)
      if (r.kind === 'dir') throw new FSError('EISDIR', `Is a directory: ${p}`)
      const data = (await wrap(s.blob.get(nodeKey(this.ws, r.id)))) as
        | Uint8Array
        | undefined
      return data ?? new Uint8Array(0)
    })
  }

  async read(path: string): Promise<string> {
    return decodeText(await this.readBytes(path))
  }

  /** One transaction covers the node and its bytes, so no temp file is needed. */
  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EISDIR', 'Is a directory: /')
    return await this.withTx('readwrite', async (s) => {
      await this.requireLive(s)
      const parent = await this.ensureDirs(s, dirname(p))
      const name = basename(p)
      const existing = await this.child(s, parent, name)
      if (existing?.kind === 'dir') throw new FSError('EISDIR', `Is a directory: ${p}`)
      const node: FsNode = existing
        ? { ...existing, size: data.byteLength, mtime: Date.now() }
        : {
            id: crypto.randomUUID(),
            ws: this.ws,
            parent,
            name,
            kind: 'file',
            size: data.byteLength,
            mtime: Date.now(),
          }
      await wrap(s.meta.put(node, nodeKey(this.ws, node.id)))
      await wrap(s.blob.put(data.slice(), nodeKey(this.ws, node.id)))
    })
  }

  write(path: string, content: string): Promise<void> {
    return this.writeBytes(path, encodeText(content))
  }

  async mkdir(path: string): Promise<void> {
    const p = normalizePath(path)
    return await this.withTx('readwrite', async (s) => {
      await this.requireLive(s)
      await this.ensureDirs(s, p)
    })
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path)
    if (p === '') throw new FSError('EINVAL', 'Cannot remove the workspace root')
    return await this.withTx('readwrite', async (s) => {
      const top = await this.resolve(s, p)
      if (!top) throw new FSError('ENOENT', `No such path: ${p}`)
      // Collect the subtree first, then delete every node and its bytes.
      const doomed: FsNode[] = []
      const queue: FsNode[] = [top]
      while (queue.length) {
        const n = queue.pop()!
        doomed.push(n)
        if (n.kind === 'dir') queue.push(...(await this.children(s, n.id)))
      }
      for (const n of doomed) {
        await wrap(s.meta.delete(nodeKey(this.ws, n.id)))
        await wrap(s.blob.delete(nodeKey(this.ws, n.id)))
      }
    })
  }

  /** One record changes: the node keeps its id, so a folder's children move with it. */
  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from)
    const dst = normalizePath(to)
    if (src === '' || dst === '') throw new FSError('EINVAL', 'Cannot rename the root')
    return await this.withTx('readwrite', async (s) => {
      await this.requireLive(s)
      const node = await this.resolve(s, src)
      if (!node) throw new FSError('ENOENT', `No such path: ${src}`)
      if (src === dst) return
      if (isWithin(dst, src)) throw new FSError('EINVAL', 'Cannot move into itself')
      if (await this.resolve(s, dst)) throw new FSError('EEXIST', `Already exists: ${dst}`)
      const parent = await this.ensureDirs(s, dirname(dst))
      const moved: FsNode = { ...node, parent, name: basename(dst) }
      await wrap(s.meta.put(moved, nodeKey(this.ws, node.id)))
    })
  }
}

export class IdbBackend implements FSBackend {
  readonly kind = 'idb'
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  open(workspaceId: string, opts: OpenOptions = {}): WorkspaceFS {
    if (workspaceId === '' || workspaceId.includes(':') || workspaceId.includes('/'))
      throw new FSError('EINVAL', 'Invalid workspace id')
    return new IdbFS(this.db, workspaceId, opts.requireWorkspace ?? false)
  }

  /**
   * Deletes the workspace's files, its record and its linked-folder record in one
   * transaction. A write that starts before it sees the record; one that starts after
   * sees the record gone and fails.
   */
  async destroy(workspaceId: string): Promise<void> {
    const tx = this.db.transaction(
      [FS_META, FS_BLOB, WORKSPACES, SETTINGS],
      'readwrite',
    )
    const prefix = `${workspaceId}:`
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff')
    tx.objectStore(FS_META).delete(range)
    tx.objectStore(FS_BLOB).delete(range)
    tx.objectStore(WORKSPACES).delete(workspaceId)
    tx.objectStore(SETTINGS).delete(linkKey(workspaceId))
    await done(tx)
  }

  close(): void {}
}
