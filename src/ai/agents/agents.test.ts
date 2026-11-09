import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentRequest, ProviderAdapter } from '../../providers'
import { chatMessagesAtom, sendChat } from '../chat'
import type { ToolHost } from '../companionTools'
import { loadAgents } from './loadAgents'
import { parseAgent } from './parseAgent'
import { agentRoute, toolsFor } from './subAgents'

const FILE = `---
name: grep
description: Finds usages.
tools: Read, Grep, Glob
model: haiku
---

You find usages.
`

describe('parseAgent', () => {
  it('reads front matter and body', () => {
    expect(parseAgent('.claude/agents/grep.md', FILE)).toEqual({
      name: 'grep',
      description: 'Finds usages.',
      model: 'haiku',
      tools: ['Read', 'Grep', 'Glob'],
      prompt: 'You find usages.',
      path: '.claude/agents/grep.md',
    })
  })
  it('falls back to the file name and rejects files without front matter or a body', () => {
    expect(parseAgent('a/x.md', '---\ndescription: d\n---\nDo it')?.name).toBe('x')
    expect(parseAgent('a/x.md', 'just text')).toBeNull()
    expect(parseAgent('a/x.md', '---\nname: x\n---\n')).toBeNull()
  })
})

describe('tools and models', () => {
  it('maps Claude tool names, defaulting to read-only', () => {
    const names = (tools?: string[]) =>
      toolsFor({
        name: 'a',
        description: '',
        prompt: 'p',
        path: 'p',
        ...(tools ? { tools } : {}),
      }).map((t) => t.name)
    expect(names(['Read', 'Edit', 'Bash'])).toEqual(['read_file', 'edit_file'])
    expect(names(['Bash'])).toEqual(['list_files', 'read_file', 'search_text'])
    expect(names()).toEqual(['list_files', 'read_file', 'search_text'])
  })
  it('maps model hints to routes', () => {
    expect(agentRoute('haiku')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    })
    expect(agentRoute('ollama/qwen2.5-coder')).toEqual({
      provider: 'ollama',
      model: 'qwen2.5-coder',
    })
    expect(agentRoute('gpt-4')).toBeNull()
    expect(agentRoute(undefined)).toBeNull()
  })
})

function repo(files: Record<string, string>): ToolHost {
  return {
    tree: async () =>
      Object.keys(files).map((path) => ({ path, name: path, kind: 'file' }) as never),
    read: async (p) => files[p] ?? null,
    search: async () => ({ hits: [], truncated: false }),
    write: async () => true,
  }
}

describe('loadAgents', () => {
  it('prefers .claude/agents over .opencode/agents and ignores nested files', async () => {
    const agents = await loadAgents(
      repo({
        '.claude/agents/grep.md': FILE,
        '.opencode/agents/grep.md': FILE.replace('Finds usages.', 'Other.'),
        '.opencode/agents/audit.md':
          '---\nname: audit\ndescription: Reviews.\n---\nReview.',
        '.claude/agents/sub/deep.md': FILE,
      }),
    )
    expect(agents.map((a) => `${a.name}:${a.description}`)).toEqual([
      'grep:Finds usages.',
      'audit:Reviews.',
    ])
  })
})

describe('run_agent', () => {
  it('runs a repo agent with its own prompt and tools, and returns only its report', async () => {
    const requests: { who: string; req: AgentRequest }[] = []
    const adapter: ProviderAdapter = {
      id: 'ollama',
      listModels: async () => [],
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('unused')
      },
      async *chat(req) {
        const sub = req.system?.includes('You are a sub-agent') ?? false
        requests.push({
          who: sub ? 'sub' : 'main',
          req: { ...req, messages: [...req.messages] },
        })
        const mainCalls = requests.filter((r) => r.who === 'main').length
        const subCalls = requests.filter((r) => r.who === 'sub').length
        const events: AgentEvent[] = sub
          ? subCalls === 1
            ? [
                {
                  type: 'call',
                  call: { id: 's1', name: 'read_file', args: { path: 'a.ts' } },
                },
              ]
            : [{ type: 'text', text: 'Found it in a.ts:1' }]
          : mainCalls === 1
            ? [
                {
                  type: 'call',
                  call: {
                    id: 'm1',
                    name: 'run_agent',
                    args: { agent: 'grep', task: 'find a' },
                  },
                },
              ]
            : [{ type: 'text', text: 'Done.' }]
        for (const e of events) yield e
      },
    }
    const resolve = (async () => ({
      adapter,
      route: { provider: 'ollama', model: 'm' },
    })) as never
    const store = createStore()
    const host = repo({
      '.claude/agents/grep.md': FILE,
      'a.ts': 'let a',
      'AGENTS.md': 'Be nice.',
    })
    await sendChat(store, 'where is a?', resolve, host, () => {
      throw new Error('no key')
    })

    const main = requests.filter((r) => r.who === 'main')
    expect(main[0]!.req.tools.map((t) => t.name)).toContain('run_agent')
    expect(main[0]!.req.system).toContain('- grep: Finds usages.')
    expect(main[0]!.req.system).toContain('Be nice.')
    const sub = requests.filter((r) => r.who === 'sub')
    expect(sub[0]!.req.system).toContain('You find usages.')
    expect(sub[0]!.req.tools.map((t) => t.name)).toEqual([
      'list_files',
      'read_file',
      'search_text',
    ])
    expect(sub[0]!.req.messages[0]).toEqual({ role: 'user', content: 'find a' })

    const first = store.get(chatMessagesAtom)[1]!
    expect(first.calls?.[0]?.result?.content).toBe('Found it in a.ts:1')
    expect(first.calls?.[0]?.progress).toMatch(/grep · 2 steps/)
    expect(store.get(chatMessagesAtom).at(-1)?.content).toBe('Done.')
  })
})
