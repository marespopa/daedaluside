import { FSError, type WorkspaceFS } from './types'

/** Shared contract: every WorkspaceFS implementation must pass these. */
export function runFSContract(
  name: string,
  makeFS: () => Promise<WorkspaceFS> | WorkspaceFS,
) {
  describe(`WorkspaceFS contract: ${name}`, () => {
    let fs: WorkspaceFS

    beforeEach(async () => {
      fs = await makeFS()
    })

    const code = async (p: Promise<unknown>) => {
      try {
        await p
      } catch (e) {
        return e instanceof FSError ? e.code : `other:${String(e)}`
      }
      return 'none'
    }
    const names = async (dir: string) => (await fs.list(dir)).map((e) => e.name)

    it('lists an empty root', async () => {
      expect(await fs.list('')).toEqual([])
    })

    it('writes and reads text, creating parents', async () => {
      await fs.write('a/b/c.txt', 'héllo')
      expect(await fs.read('a/b/c.txt')).toBe('héllo')
      expect(await fs.stat('a/b')).toMatchObject({ kind: 'dir', name: 'b' })
      expect(await fs.stat('a/b/c.txt')).toMatchObject({ kind: 'file', size: 6 })
    })

    it('round-trips binary data', async () => {
      const bytes = new Uint8Array([0, 255, 1, 254, 128])
      await fs.writeBytes('bin/x.dat', bytes)
      // Array.from: some test envs clone across realms, which breaks typed-array identity.
      expect(Array.from(await fs.readBytes('bin/x.dat'))).toEqual(Array.from(bytes))
    })

    it('overwrites with shorter content (no stale tail)', async () => {
      await fs.write('f.txt', 'long content here')
      await fs.write('f.txt', 'short')
      expect(await fs.read('f.txt')).toBe('short')
      expect(await fs.write('f.txt', '')).toBeUndefined()
      expect(await fs.read('f.txt')).toBe('')
    })

    it('leaves no temp files behind and hides them from listings', async () => {
      await fs.write('d/f.txt', '1')
      await fs.write('d/f.txt', '2')
      expect(await names('d')).toEqual(['f.txt'])
    })

    it('lists directories first, then by name', async () => {
      await fs.write('b.txt', '')
      await fs.write('a.txt', '')
      await fs.mkdir('z')
      await fs.mkdir('m')
      expect(await names('')).toEqual(['m', 'z', 'a.txt', 'b.txt'])
      expect((await fs.list(''))[0]).toMatchObject({ path: 'm', kind: 'dir' })
    })

    it('lists only direct children with full paths', async () => {
      await fs.write('a/b/c.txt', 'x')
      await fs.write('a/d.txt', 'x')
      expect(await fs.list('a')).toMatchObject([
        { path: 'a/b', kind: 'dir' },
        { path: 'a/d.txt', kind: 'file' },
      ])
    })

    it('mkdir is recursive and idempotent', async () => {
      await fs.mkdir('x/y/z')
      await fs.mkdir('x/y/z')
      expect(await names('x/y')).toEqual(['z'])
    })

    it('normalizes redundant slashes', async () => {
      await fs.write('/a//b.txt', 'x')
      expect(await fs.read('a/b.txt')).toBe('x')
    })

    it('stat returns null for missing paths and for paths under files', async () => {
      await fs.write('f', 'x')
      expect(await fs.stat('nope')).toBeNull()
      expect(await fs.stat('f/child')).toBeNull()
      expect(await fs.stat('')).toMatchObject({ kind: 'dir' })
    })

    it('reports typed errors', async () => {
      await fs.write('f', 'x')
      await fs.mkdir('d')
      expect(await code(fs.read('missing'))).toBe('ENOENT')
      expect(await code(fs.read('d'))).toBe('EISDIR')
      expect(await code(fs.list('missing'))).toBe('ENOENT')
      expect(await code(fs.list('f'))).toBe('ENOTDIR')
      expect(await code(fs.write('f/child', 'x'))).toBe('ENOTDIR')
      expect(await code(fs.write('d', 'x'))).toBe('EISDIR')
      expect(await code(fs.mkdir('f/sub'))).toBe('ENOTDIR')
      expect(await code(fs.remove('missing'))).toBe('ENOENT')
      expect(await code(fs.remove(''))).toBe('EINVAL')
      expect(await code(fs.read('../x'))).toBe('EINVAL')
      expect(await code(fs.write('a/./b', 'x'))).toBe('EINVAL')
    })

    it('removes files and whole trees', async () => {
      await fs.write('t/a/1.txt', '1')
      await fs.write('t/a/b/2.txt', '2')
      await fs.write('t/keep.txt', 'k')
      await fs.remove('t/a')
      expect(await names('t')).toEqual(['keep.txt'])
      await fs.remove('t/keep.txt')
      expect(await names('t')).toEqual([])
    })

    it('does not touch siblings sharing a name prefix', async () => {
      await fs.write('app/x.txt', '1')
      await fs.write('app2/x.txt', '2')
      await fs.remove('app')
      expect(await fs.read('app2/x.txt')).toBe('2')
    })

    it('renames files, creating destination parents', async () => {
      await fs.write('a.txt', 'A')
      await fs.rename('a.txt', 'new/dir/b.txt')
      expect(await fs.stat('a.txt')).toBeNull()
      expect(await fs.read('new/dir/b.txt')).toBe('A')
    })

    it('renames directory trees, empty dirs included', async () => {
      await fs.write('src/a.txt', 'A')
      await fs.write('src/sub/b.txt', 'B')
      await fs.mkdir('src/empty')
      await fs.rename('src', 'lib')
      expect(await fs.stat('src')).toBeNull()
      expect(await fs.read('lib/a.txt')).toBe('A')
      expect(await fs.read('lib/sub/b.txt')).toBe('B')
      expect(await fs.stat('lib/empty')).toMatchObject({ kind: 'dir' })
    })

    it('rename refuses to overwrite or move into itself', async () => {
      await fs.write('a', '1')
      await fs.write('b', '2')
      await fs.mkdir('d')
      expect(await code(fs.rename('a', 'b'))).toBe('EEXIST')
      expect(await code(fs.rename('nope', 'x'))).toBe('ENOENT')
      expect(await code(fs.rename('d', 'd/inner'))).toBe('EINVAL')
      expect(await fs.read('b')).toBe('2')
    })

    it('serializes concurrent writes to one file', async () => {
      await Promise.all(Array.from({ length: 10 }, (_, i) => fs.write('c.txt', `v${i}`)))
      expect(await fs.read('c.txt')).toBe('v9')
    })

    it('listAll returns every entry depth-first, matching repeated list calls', async () => {
      await fs.write('b.txt', '')
      await fs.write('a/x/deep.txt', 'dd')
      await fs.write('a/y.txt', 'y')
      await fs.mkdir('z')
      await fs.write('a/x/aa.txt', 'a')
      const all = await fs.listAll()
      expect(all.map((e) => e.path)).toEqual([
        'a',
        'a/x',
        'a/x/aa.txt',
        'a/x/deep.txt',
        'a/y.txt',
        'z',
        'b.txt',
      ])
      expect(all.find((e) => e.path === 'a/x/deep.txt')).toMatchObject({
        kind: 'file',
        size: 2,
      })
      expect(await fs.listAll()).toEqual(all)
    })

    it('listAll of an empty workspace is empty', async () => {
      expect(await fs.listAll()).toEqual([])
    })

    it('handles a nested workspace tree', async () => {
      const files = ['a/b/c/d.txt', 'a/b/e.txt', 'a/f.txt', 'g.txt']
      for (const f of files) await fs.write(f, f)
      expect(await names('a/b')).toEqual(['c', 'e.txt'])
      for (const f of files) expect(await fs.read(f)).toBe(f)
    })
  })
}
