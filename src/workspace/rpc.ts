import type { Entry, FSBackend, FSErrorCode, WorkspaceFS } from './types'
import { FSError } from './types'

export const FS_METHODS = [
  'list',
  'listAll',
  'stat',
  'read',
  'readBytes',
  'write',
  'writeBytes',
  'mkdir',
  'remove',
  'rename',
] as const
export type FSMethod = (typeof FS_METHODS)[number]

export type Request =
  | { id: number; op: 'fs'; ws: string; method: FSMethod; args: unknown[] }
  | { id: number; op: 'destroy'; ws: string }
  | { id: number; op: 'probe' }

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { code: FSErrorCode | null; message: string } }

/** Server side: runs a request against a backend. Used by the worker and by tests. */
export function createHandler(
  backend: Pick<FSBackend, 'open' | 'destroy'>,
  probe: () => Promise<void>,
) {
  const open = new Map<string, WorkspaceFS>()
  const fsFor = (ws: string) => {
    let fs = open.get(ws)
    if (!fs) open.set(ws, (fs = backend.open(ws)))
    return fs
  }
  return async (req: Request): Promise<Response> => {
    try {
      let value: unknown
      if (req.op === 'probe') await probe()
      else if (req.op === 'destroy') {
        open.delete(req.ws)
        await backend.destroy(req.ws)
      } else {
        if (!FS_METHODS.includes(req.method))
          throw new FSError('EINVAL', 'Unknown method')
        const fs = fsFor(req.ws)
        value = await (fs[req.method] as (...a: unknown[]) => Promise<unknown>)(
          ...req.args,
        )
      }
      return { id: req.id, ok: true, value }
    } catch (e) {
      const code = e instanceof FSError ? e.code : null
      return {
        id: req.id,
        ok: false,
        error: { code, message: e instanceof Error ? e.message : String(e) },
      }
    }
  }
}

/** The subset of `Worker` the client needs, so tests can use a loopback. */
export interface WorkerLike {
  postMessage(msg: Request): void
  addEventListener(type: 'message', fn: (e: MessageEvent<Response>) => void): void
  addEventListener(type: 'error', fn: (e: Event) => void): void
  terminate(): void
}

/** Typed promise-based client for the fs worker. */
export class RpcBackend implements FSBackend {
  readonly kind = 'opfs'
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >()
  private readonly worker: WorkerLike

  constructor(worker: WorkerLike) {
    this.worker = worker
    worker.addEventListener('message', (e) => {
      const res = e.data
      const p = this.pending.get(res.id)
      if (!p) return
      this.pending.delete(res.id)
      if (res.ok) p.resolve(res.value)
      else
        p.reject(
          res.error.code
            ? new FSError(res.error.code, res.error.message)
            : new Error(res.error.message),
        )
    })
    worker.addEventListener('error', () => this.failAll(new Error('FS worker crashed')))
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private call(req: DistributiveOmit<Request, 'id'>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id } as Request)
    })
  }

  probe(): Promise<void> {
    return this.call({ op: 'probe' }) as Promise<void>
  }

  open(ws: string): WorkspaceFS {
    const m =
      <T>(method: FSMethod) =>
      (...args: unknown[]) =>
        this.call({ op: 'fs', ws, method, args }) as Promise<T>
    return {
      list: m<Entry[]>('list'),
      listAll: m<Entry[]>('listAll'),
      stat: m<Entry | null>('stat'),
      read: m<string>('read'),
      readBytes: m<Uint8Array>('readBytes'),
      write: m<void>('write'),
      writeBytes: m<void>('writeBytes'),
      mkdir: m<void>('mkdir'),
      remove: m<void>('remove'),
      rename: m<void>('rename'),
    }
  }

  async destroy(ws: string): Promise<void> {
    await this.call({ op: 'destroy', ws })
  }

  close(): void {
    this.failAll(new Error('FS backend closed'))
    this.worker.terminate()
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
