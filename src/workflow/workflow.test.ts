import { describe, expect, it } from 'vitest'
import type { ProviderAdapter, StreamRequest } from '../providers'
import { ProviderError } from '../providers'
import { buildContext, referencedPaths } from './context'
import { PatchError, checkPath, parsePatches, resolvePatches } from './patches'
import { Workflow } from './pipeline'
import type { Run } from './runs'
import { listRuns, saveRun } from './runs'

const block = (path: string, search: string, replace: string) =>
  `FILE: ${path}\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n`

describe('buildContext', () => {
  it('puts the active file first and lists the tree', () => {
    const text = buildContext({
      activePath: 'b.ts',
      openFiles: [
        { path: 'a.ts', content: 'A' },
        { path: 'b.ts', content: 'B' },
      ],
      treePaths: ['a.ts', 'b.ts'],
    })
    expect(text.indexOf('path="b.ts"')).toBeLessThan(text.indexOf('path="a.ts"'))
    expect(text).toContain('<files>\na.ts\nb.ts\n</files>')
  })

  it('truncates a file that does not fit and drops the rest', () => {
    const text = buildContext({
      activePath: 'a.ts',
      openFiles: [
        { path: 'a.ts', content: 'x'.repeat(5000) },
        { path: 'b.ts', content: 'y' },
      ],
      treePaths: [],
      budgetChars: 600,
    })
    expect(text.length).toBeLessThanOrEqual(700)
    expect(text).toContain('[truncated]')
    expect(text).not.toContain('path="b.ts"')
  })

  it('caps a long tree listing', () => {
    const paths = Array.from({ length: 400 }, (_, i) => `f${i}.ts`)
    expect(buildContext({ activePath: null, openFiles: [], treePaths: paths })).toContain(
      '… and 100 more',
    )
  })
})

describe('referencedPaths', () => {
  it('finds paths in backticks and skips plain words', () => {
    const plan = 'Edit `src/a.ts` and `./b.css`, call `foo()` and `npm`, see `src/lib`.'
    expect(referencedPaths(plan)).toEqual(['src/a.ts', 'b.css', 'src/lib'])
  })
})

describe('parsePatches', () => {
  it('reads blocks through markdown fences and merges the same file', () => {
    const text =
      '```\n' + block('a.ts', 'one', 'two') + block('a.ts', 'three', 'four') + '```'
    const raw = parsePatches(text)
    expect(raw).toHaveLength(1)
    expect(raw[0]!.edits).toEqual([
      { search: 'one', replace: 'two' },
      { search: 'three', replace: 'four' },
    ])
  })

  it('rejects a block with no FILE line and one that was cut off', () => {
    expect(() => parsePatches('<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE')).toThrow(
      PatchError,
    )
    expect(() => parsePatches('FILE: a.ts\n<<<<<<< SEARCH\na\n=======\nb')).toThrow(
      /not closed/,
    )
  })
})

describe('checkPath', () => {
  it.each([
    '../x',
    '/etc/passwd',
    'a/../b',
    'C:/x',
    'a\\b',
    '.git/config',
    'src/.git/x',
    '',
    'a//b',
  ])('refuses %j', (p) => expect(() => checkPath(p)).toThrow(PatchError))
  it('accepts a normal path', () => expect(checkPath('./src/a.ts')).toBe('src/a.ts'))
})

describe('resolvePatches', () => {
  const files: Record<string, string> = {
    'a.ts': 'let x = 1\nlet y = 2\n',
    'dup.ts': 'a\na\n',
    'w.ts': 'a\r\nb\r\n',
  }
  const read = async (p: string) => files[p] ?? null

  it('edits an existing file', async () => {
    const out = await resolvePatches(
      parsePatches(block('a.ts', 'let x = 1', 'let x = 9')),
      read,
    )
    expect(out).toEqual([
      { path: 'a.ts', base: files['a.ts'], content: 'let x = 9\nlet y = 2\n' },
    ])
  })

  it('creates a file from an empty SEARCH', async () => {
    const out = await resolvePatches(
      parsePatches('FILE: n.ts\n<<<<<<< SEARCH\n=======\nhi\n>>>>>>> REPLACE'),
      read,
    )
    expect(out).toEqual([{ path: 'n.ts', base: null, content: 'hi\n' }])
  })

  it('fails on missing, ambiguous, and existing-file creates', async () => {
    await expect(
      resolvePatches(parsePatches(block('a.ts', 'nope', 'z')), read),
    ).rejects.toThrow(/not found/)
    await expect(
      resolvePatches(parsePatches(block('dup.ts', 'a', 'b')), read),
    ).rejects.toThrow(/2 places/)
    await expect(
      resolvePatches(parsePatches(block('gone.ts', 'a', 'b')), read),
    ).rejects.toThrow(/does not exist/)
    await expect(
      resolvePatches(
        parsePatches('FILE: a.ts\n<<<<<<< SEARCH\n=======\nx\n>>>>>>> REPLACE'),
        read,
      ),
    ).rejects.toThrow(/already exists/)
  })

  it('keeps CRLF line endings', async () => {
    const out = await resolvePatches(parsePatches(block('w.ts', 'a', 'z')), read)
    expect(out[0]!.content).toBe('z\r\nb\r\n')
  })

  it('refuses unsafe paths and empty results', async () => {
    await expect(
      resolvePatches(parsePatches(block('../x', 'a', 'b')), read),
    ).rejects.toThrow(/not allowed/)
    await expect(
      resolvePatches(parsePatches(block('a.ts', 'let x = 1', 'let x = 1')), read),
    ).rejects.toThrow(/no changes/)
  })
})

/** Replies in order, one per stream call, and records the requests. */
function fakeAdapter(replies: (string | Error)[]) {
  const requests: StreamRequest[] = []
  const adapter: ProviderAdapter = {
    id: 'ollama',
    listModels: async () => [],
    async *stream(req, signal) {
      requests.push(req)
      const reply = replies.shift() ?? ''
      if (reply instanceof Error) throw reply
      for (const ch of reply.match(/[\s\S]{1,7}/g) ?? []) {
        if (signal?.aborted) throw new ProviderError('aborted', 'x')
        yield ch
      }
    },
  }
  return { adapter, requests }
}

function setup(
  replies: (string | Error)[],
  files: Record<string, string> = { 'a.ts': 'one\n' },
) {
  const { adapter, requests } = fakeAdapter(replies)
  const runs: Run[] = []
  let n = 0
  const wf = new Workflow({
    resolveStage: async (stage) => ({
      adapter,
      route: { provider: 'ollama', model: stage === 'plan' ? 'big' : 'small' },
    }),
    readFile: async (p) => files[p] ?? null,
    saveRun: async (r) => void runs.push(structuredClone(r)),
    now: () => ++n,
    newId: () => 'run-1',
  })
  return { wf, requests, runs }
}

describe('Workflow', () => {
  it('runs plan, review, execute and apply to completion', async () => {
    const { wf, requests, runs } = setup(['1. Edit `a.ts`', block('a.ts', 'one', 'two')])
    const seen: string[] = []
    wf.subscribe(() => seen.push(wf.state.phase))

    await wf.plan('rename one', 'CTX')
    expect(wf.state.phase).toBe('plan-review')
    expect(wf.state.plan).toBe('1. Edit `a.ts`')

    await wf.execute('1. Edit `a.ts` (edited)', 'CTX')
    expect(wf.state.phase).toBe('diff-review')
    expect(wf.state.patches).toEqual([{ path: 'a.ts', base: 'one\n', content: 'two\n' }])
    // The approved (edited) plan and the referenced file reach the execute model.
    const exec = requests[1]!
    expect(exec.model).toBe('small')
    expect(exec.messages[0]!.content).toContain('(edited)')
    expect(exec.messages[0]!.content).toContain('<file path="a.ts">\none\n')

    wf.beginApply()
    await wf.complete()
    expect(wf.state.phase).toBe('completed')
    expect(seen).toEqual([
      'planning',
      'plan-review',
      'executing',
      'diff-review',
      'applying',
      'completed',
    ])

    expect(runs.at(-1)).toMatchObject({
      id: 'run-1',
      phase: 'completed',
      files: ['a.ts'],
      planModel: 'ollama/big',
      executeModel: 'ollama/small',
    })
  })

  it('revision sends the old plan and the feedback back to the model', async () => {
    const { wf, requests } = setup(['plan v1', 'plan v2'])
    await wf.plan('t', 'CTX')
    await wf.revise('shorter please')
    expect(wf.state.plan).toBe('plan v2')
    expect(requests[1]!.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    expect(requests[1]!.messages[1]!.content).toBe('plan v1')
  })

  it('fails without touching anything when a patch does not match, and can retry', async () => {
    const { wf } = setup([
      'plan',
      block('a.ts', 'missing', 'x'),
      block('a.ts', 'one', 'two'),
    ])
    await wf.plan('t', 'CTX')
    await wf.execute('plan', 'CTX')
    expect(wf.state.phase).toBe('failed')
    expect(wf.state.error).toMatch(/not found/)
    await wf.execute('plan', 'CTX')
    expect(wf.state.phase).toBe('diff-review')
  })

  it('reports a provider error as failed', async () => {
    const { wf, runs } = setup([
      new ProviderError('auth', 'The provider rejected the API key'),
    ])
    await wf.plan('t', 'CTX')
    expect(wf.state).toMatchObject({
      phase: 'failed',
      error: 'The provider rejected the API key',
    })
    expect(runs).toHaveLength(0) // no plan was produced, so there is no run to save
  })

  it('cancel stops the stream and lands in cancelled', async () => {
    const { wf } = setup(['x'.repeat(200)])
    let first = true
    await wf.plan('t', 'CTX', () => {
      if (first) wf.cancel()
      first = false
    })
    expect(wf.state.phase).toBe('cancelled')
  })

  it('refuses out-of-order calls and foreign patches', async () => {
    const { wf } = setup(['plan', block('a.ts', 'one', 'two')])
    await expect(wf.execute('p', 'c')).rejects.toThrow(/Not allowed/)
    await wf.plan('t', 'CTX')
    expect(() => wf.beginApply()).toThrow(/Not allowed/)
    await wf.execute('plan', 'CTX')
    expect(() => wf.beginApply([{ path: 'other.ts', base: null, content: '' }])).toThrow(
      /not proposed/,
    )
    await expect(wf.execute('  ', 'c')).rejects.toThrow(/empty plan/)
  })

  it('treats an empty plan reply as a failure', async () => {
    const { wf } = setup(['   '])
    await wf.plan('t', 'CTX')
    expect(wf.state.phase).toBe('failed')
  })
})

describe('runs store', () => {
  it('saves and lists newest first', async () => {
    const base = {
      task: 't',
      plan: 'p',
      phase: 'completed' as const,
      planModel: '',
      executeModel: '',
      files: [],
      error: null,
    }
    await saveRun({ ...base, id: 'a', createdAt: 1, updatedAt: 1 })
    await saveRun({ ...base, id: 'b', createdAt: 2, updatedAt: 2 })
    expect((await listRuns()).map((r) => r.id)).toEqual(['b', 'a'])
  })
})
