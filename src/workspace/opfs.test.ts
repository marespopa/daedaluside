import { OpfsBackend } from './opfs-fs'
import { createHandler, RpcBackend, type Request, type Response } from './rpc'
import { memoryRoot } from './testing/memoryOpfs'
import { runFSContract } from './fsContract'
import { FSError } from './types'

runFSContract('OPFS (sync handles, native move)', () => {
  const root = memoryRoot()
  return new OpfsBackend(async () => root)
})

runFSContract('OPFS (copy fallback, no move)', () => {
  const root = memoryRoot({ supportsMove: false })
  return new OpfsBackend(async () => root)
})

runFSContract('OPFS through the worker RPC', () => {
  const root = memoryRoot()
  const handle = createHandler(new OpfsBackend(async () => root), async () => undefined)
  // Loopback "worker" (no structured clone: jsdom realms break typed-array identity).
  let onMessage: (e: MessageEvent<Response>) => void = () => undefined
  const worker = {
    postMessage(msg: Request) {
      void handle(msg).then((res) => onMessage({ data: res } as MessageEvent<Response>))
    },
    addEventListener(type: string, fn: unknown) {
      if (type === 'message') onMessage = fn as typeof onMessage
    },
    terminate() {},
  }
  return new RpcBackend(worker as never)
})

describe('OPFS atomic writes', () => {
  it('keeps the old content when the write fails midway', async () => {
    const root = memoryRoot()
    const fs = new OpfsBackend(async () => root).open('w')
    await fs.write('f.txt', 'old')
    const dir = await (
      await root.getDirectoryHandle('workspaces')
    ).getDirectoryHandle('w')
    // Hold the temp file's lock so the temp write fails.
    const tmp = await dir.getFileHandle('f.txt.daedalus-tmp', { create: true })
    const lock = await tmp.createSyncAccessHandle()
    await expect(fs.write('f.txt', 'new')).rejects.toThrow()
    lock.close()
    expect(await fs.read('f.txt')).toBe('old')
  })

  it('rejects the reserved temp suffix', async () => {
    const fs = new OpfsBackend(async () => memoryRoot()).open('w')
    await expect(fs.write('x.daedalus-tmp', '')).rejects.toBeInstanceOf(FSError)
  })
})
