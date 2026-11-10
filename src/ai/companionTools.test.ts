import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../providers'
import { describeCall, runTool } from './companionTools'
import type { ToolHost } from './companionTools'

/** An in-memory workspace; `writes` records what the tools asked to write. */
function fakeHost(files: Record<string, string>) {
  const writes: { path: string; base: string | null; content: string }[] = []
  const host: ToolHost = {
    tree: async () =>
      Object.keys(files).map((path) => ({
        name: path.split('/').at(-1) ?? path,
        path,
        kind: 'file' as const,
      })),
    read: async (path) => files[path] ?? null,
    search: async (query) => ({
      hits: Object.entries(files).flatMap(([path, text]) =>
        text
          .split('\n')
          .flatMap((line, i) =>
            line.includes(query)
              ? [{ path, line: i + 1, col: line.indexOf(query), text: line, start: 0 }]
              : [],
          ),
      ) as never,
      truncated: false,
    }),
    write: async (path, base, content) => {
      writes.push({ path, base, content })
      files[path] = content
      return true
    },
  }
  return { host, writes }
}

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: 'c',
  name,
  args,
})

describe('companion tools', () => {
  it('lists files under a folder and hides .git', async () => {
    const { host } = fakeHost({
      'a.ts': '',
      'src/b.ts': '',
      'src/c.ts': '',
      '.git/x': '',
    })
    expect((await runTool(host, call('list_files', { dir: 'src' }))).content).toBe(
      'src/b.ts\nsrc/c.ts',
    )
    expect((await runTool(host, call('list_files', {}))).content).toBe(
      'a.ts\nsrc/b.ts\nsrc/c.ts',
    )
  })

  it('reads a file and reports a missing one as an error result', async () => {
    const { host } = fakeHost({ 'a.ts': 'let a' })
    expect(await runTool(host, call('read_file', { path: 'a.ts' }))).toMatchObject({
      content: 'let a',
    })
    const miss = await runTool(host, call('read_file', { path: 'nope.ts' }))
    expect(miss).toMatchObject({ isError: true, content: 'Cannot read nope.ts' })
  })

  it('searches text', async () => {
    const { host } = fakeHost({ 'a.ts': 'x\nneedle here' })
    expect((await runTool(host, call('search_text', { query: 'needle' }))).content).toBe(
      'a.ts:2: needle here',
    )
    expect((await runTool(host, call('search_text', { query: 'zzz' }))).content).toBe(
      'No matches.',
    )
  })

  it('edits one unique match, passing the text it read as the base', async () => {
    const { host, writes } = fakeHost({ 'a.ts': 'one\ntwo\nthree' })
    const r = await runTool(
      host,
      call('edit_file', { path: 'a.ts', search: 'two', replace: '2$&' }),
    )
    expect(r.content).toBe('Edited a.ts.')
    expect(writes).toEqual([
      { path: 'a.ts', base: 'one\ntwo\nthree', content: 'one\n2$&\nthree' },
    ])
  })

  it('refuses an edit whose search is missing or ambiguous, without writing', async () => {
    const { host, writes } = fakeHost({ 'a.ts': 'x x' })
    const none = await runTool(
      host,
      call('edit_file', { path: 'a.ts', search: 'y', replace: 'z' }),
    )
    const many = await runTool(
      host,
      call('edit_file', { path: 'a.ts', search: 'x', replace: 'z' }),
    )
    expect(none).toMatchObject({ isError: true })
    expect(many).toMatchObject({ isError: true })
    expect(many.content).toContain('matches 2 times')
    expect(writes).toEqual([])
  })

  it('creates and replaces files with write_file', async () => {
    const { host, writes } = fakeHost({ 'a.ts': 'old' })
    expect(
      (await runTool(host, call('write_file', { path: 'new.ts', content: 'n' }))).content,
    ).toBe('Created new.ts.')
    expect(
      (await runTool(host, call('write_file', { path: 'a.ts', content: 'new' }))).content,
    ).toBe('Replaced a.ts.')
    expect(writes.map((w) => w.base)).toEqual([null, 'old'])
  })

  it('does not write when the content is unchanged', async () => {
    const { host, writes } = fakeHost({ 'a.ts': 'same' })
    await runTool(host, call('write_file', { path: 'a.ts', content: 'same' }))
    expect(writes).toEqual([])
  })

  it('rejects paths that leave the workspace or touch .git', async () => {
    const { host, writes } = fakeHost({})
    for (const path of ['../x', '/etc/passwd', '.git/config', 'a/../b', 'C:/x']) {
      const r = await runTool(host, call('write_file', { path, content: 'x' }))
      expect(r).toMatchObject({ isError: true })
    }
    expect(writes).toEqual([])
  })

  it('reports bad arguments and unknown tools as errors', async () => {
    const { host } = fakeHost({})
    expect(await runTool(host, call('read_file', {}))).toMatchObject({ isError: true })
    expect(await runTool(host, call('rm_rf', {}))).toMatchObject({
      isError: true,
      content: 'Unknown tool: rm_rf',
    })
  })

  it('describes a call for the chat log', () => {
    expect(describeCall(call('edit_file', { path: 'a.ts' }))).toBe('Edit a.ts')
    expect(describeCall(call('list_files', {}))).toBe('List files')
  })
})
