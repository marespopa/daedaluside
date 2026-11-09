import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import { editorWidthAtom, vimEnabledAtom } from '../state/editorAtoms'
import { runTool } from '../ai/companionTools'
import type { ToolHost } from '../ai/companionTools'
import { ACTIONS, ActionError, describeActions, runAction } from './registry'

describe('action registry', () => {
  it('has unique ids and describes every action', () => {
    const ids = ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACTIONS) expect(describeActions()).toContain(a.id)
  })

  it('runs store-only actions', async () => {
    const store = createStore()
    const before = store.get(vimEnabledAtom)
    await runAction(store, 'editor.toggle-vim')
    expect(store.get(vimEnabledAtom)).toBe(!before)
    await runAction(store, 'view.toggle-width')
    expect(store.get(editorWidthAtom)).toBe('full')
  })

  it('fold actions need an open editor', async () => {
    const store = createStore()
    await expect(runAction(store, 'editor.fold-all')).rejects.toThrow('No file is open')
    await expect(runAction(store, 'editor.unfold-all')).rejects.toThrow('No file is open')
  })

  it('rejects unknown actions, missing args and unknown themes', async () => {
    const store = createStore()
    await expect(runAction(store, 'nope')).rejects.toThrow(ActionError)
    await expect(runAction(store, 'file.open')).rejects.toThrow('"path" is required')
    await expect(runAction(store, 'theme.set', { theme: 'neon' })).rejects.toThrow(
      'Unknown theme',
    )
  })

  it('asks before a confirm action and stops when the user declines', async () => {
    const store = createStore()
    const asked: string[] = []
    await expect(
      runAction(store, 'tab.close-all', {}, (m) => (asked.push(m), false)),
    ).rejects.toThrow('declined')
    expect(asked).toHaveLength(1)
  })
})

describe('action tools', () => {
  const host = (actions?: ToolHost['actions']): ToolHost => ({
    tree: async () => [],
    read: async () => null,
    search: async () => ({ hits: [], truncated: false }),
    write: async () => true,
    ...(actions ? { actions } : {}),
  })

  it('list_actions and run_action go through the host', async () => {
    const h = host({
      list: () => 'a.b: does it',
      run: async (id, args) => `ran ${id} ${args.x}`,
    })
    expect((await runTool(h, { id: '1', name: 'list_actions', args: {} })).content).toBe(
      'a.b: does it',
    )
    const r = await runTool(h, {
      id: '2',
      name: 'run_action',
      args: { id: 'a.b', args: { x: 'y', n: 3 } },
    })
    expect(r.content).toBe('ran a.b y')
  })

  it('reports an error result when there is no editor', async () => {
    const r = await runTool(host(), { id: '1', name: 'run_action', args: { id: 'a' } })
    expect(r.isError).toBe(true)
  })
})
