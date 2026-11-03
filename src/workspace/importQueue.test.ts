import { ImportQueue } from './importQueue'
import type { ImportEntry } from './archive'
import type { WorkspaceFS } from './types'

const file = (path: string, read: () => Promise<Uint8Array>): ImportEntry => ({
  kind: 'file',
  path,
  read,
})
const bytes = async () => new Uint8Array([1])

/** Records the order and overlap of writes and reads. */
function fakeFS() {
  const writes: string[] = []
  const fs = {
    mkdir: async (p: string) => void writes.push(`dir:${p}`),
    writeBytes: async (p: string) => void writes.push(p),
  } as unknown as WorkspaceFS
  return { fs, writes }
}

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ImportQueue', () => {
  it('copies everything and reports progress', async () => {
    const { fs, writes } = fakeFS()
    const progress: number[] = []
    const q = new ImportQueue(
      fs,
      [{ kind: 'dir', path: 'src' }, file('a.ts', bytes), file('src/b.ts', bytes)],
      { concurrency: 1, onProgress: (p) => progress.push(p.done) },
    )
    await q.idle
    expect(writes).toEqual(['dir:src', 'a.ts', 'src/b.ts'])
    expect(progress).toEqual([1, 2, 3])
    expect(q.remaining()).toBe(0)
  })

  it('promotes a queued file ahead of the rest', async () => {
    const { fs, writes } = fakeFS()
    const q = new ImportQueue(
      fs,
      [file('a.ts', bytes), file('b.ts', bytes), file('c.ts', bytes)],
      { concurrency: 1 },
    )
    await q.promote('c.ts')
    await q.idle
    expect(writes).toEqual(['a.ts', 'c.ts', 'b.ts'])
  })

  it('reads in parallel up to the concurrency limit', async () => {
    const { fs } = fakeFS()
    let inFlight = 0
    let peak = 0
    const gates = Array.from({ length: 10 }, () => deferred())
    const entries = gates.map((g, i) =>
      file(`f${i}.ts`, async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await g.promise
        inFlight--
        return new Uint8Array()
      }),
    )
    const q = new ImportQueue(fs, entries, { concurrency: 3 })
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(peak).toBe(3)
    gates.forEach((g) => g.resolve())
    await q.idle
    expect(peak).toBe(3)
  })

  it('a failed read rejects only that file, and the rest still copy', async () => {
    const { fs, writes } = fakeFS()
    const q = new ImportQueue(
      fs,
      [
        file('bad.ts', async () => {
          throw new Error('disk gone')
        }),
        file('good.ts', bytes),
      ],
      { concurrency: 1 },
    )
    await expect(q.promote('bad.ts')).rejects.toThrow('disk gone')
    await q.idle
    expect(writes).toEqual(['good.ts'])
  })

  it('cancel rejects the files still waiting and lets idle resolve', async () => {
    const { fs } = fakeFS()
    const gate = deferred()
    const q = new ImportQueue(
      fs,
      [
        file('first.ts', async () => {
          await gate.promise
          return new Uint8Array()
        }),
        file('second.ts', bytes),
      ],
      { concurrency: 1 },
    )
    const waiting = q.promote('second.ts')!
    q.cancel()
    await expect(waiting).rejects.toThrow('Import cancelled')
    gate.resolve()
    await q.idle
    expect(q.remaining()).toBe(0)
  })

  it('lists what is still pending, and an empty import is idle at once', async () => {
    const { fs } = fakeFS()
    const gate = deferred()
    const q = new ImportQueue(
      fs,
      [
        file('docs/a.md', () => gate.promise.then(() => new Uint8Array())),
        file('b.ts', bytes),
      ],
      { concurrency: 1 },
    )
    expect(q.pendingPaths()).toEqual(['docs/a.md', 'b.ts'])
    expect(q.pendingEntries()).toContainEqual({
      name: 'a.md',
      path: 'docs/a.md',
      kind: 'file',
    })
    gate.resolve()
    await q.idle
    await new ImportQueue(fs, []).idle
    expect(q.pendingPaths()).toEqual([])
  })
})
