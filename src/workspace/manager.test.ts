import { describe, beforeEach, expect, it, vi } from 'vitest'
import { openDB } from './db'
import { WorkspaceManager } from './manager'
import { MemDisk } from './testing/memoryDisk'
import type { LinkedFolder } from './types'

describe('WorkspaceManager', () => {
  beforeEach(() => {
    // The global test setup swaps link storage for an in-memory map; pruning must
    // be tested against the real IndexedDB stores.
    vi.restoreAllMocks()
  })

  async function makeManager(): Promise<WorkspaceManager> {
    return new WorkspaceManager(await openDB())
  }

  it('prunes workspaces without a linked folder and preserves linked ones', async () => {
    const manager = await makeManager()
    const disk = new MemDisk()
    const linked = await manager.create('linked')
    await manager.setLink(linked.id, disk.handle() as unknown as LinkedFolder)
    const stale = await manager.create('stale')

    const kept = await manager.pruneUnlinked()

    expect(kept.map((w) => w.id)).toEqual([linked.id])
    expect(await manager.get(stale.id)).toBeUndefined()
    expect((await manager.list()).map((w) => w.id)).toEqual([linked.id])
    // The preserved workspace still opens: its link survived the prune.
    expect((await manager.getLink(linked.id))?.name).toBe(disk.handle().name)
  })

  it('announces a prune once, not once per deleted workspace', async () => {
    const manager = await makeManager()
    await manager.create('a')
    await manager.create('b')
    await manager.create('c')
    const post = vi.spyOn(BroadcastChannel.prototype, 'postMessage')
    // create() announces; clear that history so only the prune is counted.
    post.mockClear()

    await manager.pruneUnlinked()

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({ ws: null })
    expect(await manager.list()).toEqual([])
  })

  it('prunes nothing, and announces nothing, when every workspace is linked', async () => {
    const manager = await makeManager()
    const one = await manager.create('one')
    await manager.setLink(one.id, new MemDisk().handle() as unknown as LinkedFolder)
    const post = vi.spyOn(BroadcastChannel.prototype, 'postMessage')

    const kept = await manager.pruneUnlinked()

    expect(kept.map((w) => w.id)).toEqual([one.id])
    expect(post).not.toHaveBeenCalled()
  })

  it('pins and unpins a workspace', async () => {
    const m = await makeManager()
    const ws = await m.create('Alpha')
    expect(ws.pinned).toBeUndefined()
    await m.setPinned(ws.id, true)
    expect((await m.get(ws.id))?.pinned).toBe(true)
    await m.setPinned(ws.id, false)
    expect((await m.get(ws.id))?.pinned).toBe(false)
  })

  it('creates, renames, saves sessions and deletes records without touching disk', async () => {
    const disk = new MemDisk()
    disk.setFile('x/y.txt', new TextEncoder().encode('data'))
    const m = await makeManager()
    const ws = await m.create('  Alpha ')
    expect(ws.name).toBe('Alpha')
    await m.setLink(ws.id, disk.handle() as never)
    await m.rename(ws.id, 'Beta')
    await m.saveSession(ws.id, ['x/y.txt'], 'x/y.txt')
    expect(await m.get(ws.id)).toMatchObject({
      name: 'Beta',
      openFiles: ['x/y.txt'],
      activeFile: 'x/y.txt',
    })
    await m.setLastId(ws.id)
    expect(await m.getLastId()).toBe(ws.id)
    await expect(m.create('   ')).rejects.toThrow()
    await m.remove(ws.id)
    expect(await m.list()).toEqual([])
    // The linked folder is untouched.
    expect(disk.files.has('x/y.txt')).toBe(true)
  })
})
