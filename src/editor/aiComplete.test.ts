import {
  autocompletion,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiComplete } from './aiComplete'

function setup(
  complete: (ctx: { prefix: string; suffix: string }) => Promise<string | null>,
  enabled = true,
) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: 'const a',
      extensions: aiComplete({ enabled: () => enabled, complete, delay: 10 }),
    }),
  })
  return view
}

const type = (view: EditorView, text: string) =>
  view.dispatch({
    changes: { from: view.state.doc.length, insert: text },
    selection: { anchor: view.state.doc.length + text.length },
    userEvent: 'input.type',
  })

const tab = (view: EditorView) =>
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true }),
  )

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('aiComplete with the word popup', () => {
  it('closes the popup so the suggestion shows and Tab accepts it', async () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: 'const a',
        extensions: [
          autocompletion({
            override: [
              () => ({ from: 0, options: [{ label: 'const' }, { label: 'constant' }] }),
            ],
          }),
          aiComplete({ enabled: () => true, complete: async () => ' = 1', delay: 10 }),
        ],
      }),
    })
    type(view, ' ')
    startCompletion(view)
    await vi.waitFor(() => expect(completionStatus(view.state)).not.toBeNull())
    await vi.waitFor(() => expect(view.dom.querySelector('.cm-ai-ghost')).not.toBeNull())
    expect(completionStatus(view.state)).toBeNull()
    tab(view)
    expect(view.state.doc.toString()).toBe('const a  = 1')
    view.destroy()
  })
})

const key = (view: EditorView, k: string, mods: KeyboardEventInit = {}) =>
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }),
  )

const typeAt = (view: EditorView, text: string) =>
  view.dispatch({
    changes: { from: view.state.selection.main.head, insert: text },
    selection: { anchor: view.state.selection.main.head + text.length },
    userEvent: 'input.type',
  })

describe('aiComplete, Copilot flow', () => {
  it('keeps the rest of a suggestion while you type its next characters', async () => {
    const complete = vi.fn().mockResolvedValue(' = compute(1)')
    const view = setup(complete)
    type(view, ' ')
    await vi.waitFor(() => expect(view.dom.querySelector('.cm-ai-ghost')).not.toBeNull())
    typeAt(view, ' ')
    typeAt(view, '=')
    typeAt(view, ' ')
    expect(view.dom.querySelector('.cm-ai-ghost')?.textContent).toBe('compute(1)')
    // No second request: the first one still covers what is left.
    await new Promise((r) => setTimeout(r, 40))
    expect(complete).toHaveBeenCalledTimes(1)
    typeAt(view, 'x')
    expect(view.dom.querySelector('.cm-ai-ghost')).toBeNull()
    view.destroy()
  })

  it('accepts one word at a time with Ctrl-Right', async () => {
    const view = setup(vi.fn().mockResolvedValue(' = compute(1)'))
    type(view, ' ')
    await vi.waitFor(() => expect(view.dom.querySelector('.cm-ai-ghost')).not.toBeNull())
    key(view, 'ArrowRight', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('const a  =')
    expect(view.dom.querySelector('.cm-ai-ghost')?.textContent).toBe(' compute(1)')
    key(view, 'ArrowRight', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('const a  = compute(1)')
    expect(view.dom.querySelector('.cm-ai-ghost')).toBeNull()
    view.destroy()
  })

  it('Escape dismisses the suggestion', async () => {
    const view = setup(vi.fn().mockResolvedValue(' = 1'))
    type(view, ' ')
    await vi.waitFor(() => expect(view.dom.querySelector('.cm-ai-ghost')).not.toBeNull())
    key(view, 'Escape')
    expect(view.dom.querySelector('.cm-ai-ghost')).toBeNull()
    view.destroy()
  })

  it('asks again on a new line below code, and while closers follow the cursor', async () => {
    const complete = vi.fn().mockResolvedValue('return 1')
    const view = setup(complete)
    view.dispatch({
      changes: { from: view.state.doc.length, insert: ' {\n  ' },
      selection: { anchor: view.state.doc.length + 4 },
      userEvent: 'input',
    })
    await vi.waitFor(() => expect(complete).toHaveBeenCalled())
    expect(view.dom.querySelector('.cm-ai-ghost')).not.toBeNull()
    view.destroy()
  })
})

describe('aiComplete', () => {
  it('shows a suggestion after a pause, and Tab accepts it', async () => {
    const complete = vi.fn().mockResolvedValue(' = 1')
    const view = setup(complete)
    type(view, ' ')
    await vi.waitFor(() => expect(view.dom.querySelector('.cm-ai-ghost')).not.toBeNull())
    expect(complete).toHaveBeenCalledWith(
      { prefix: 'const a ', suffix: '' },
      expect.anything(),
    )
    expect(view.dom.querySelector('.cm-ai-ghost')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
    tab(view)
    expect(view.state.doc.toString()).toBe('const a  = 1')
    expect(view.dom.querySelector('.cm-ai-ghost')).toBeNull()
    view.destroy()
  })

  it('drops the suggestion when the user keeps typing', async () => {
    const view = setup(vi.fn().mockResolvedValue(' = 1'))
    type(view, ' ')
    await vi.waitFor(() => expect(view.dom.querySelector('.cm-ai-ghost')).not.toBeNull())
    type(view, '=')
    expect(view.dom.querySelector('.cm-ai-ghost')).toBeNull()
    view.destroy()
  })

  it('stays quiet when disabled, empty, or the request fails', async () => {
    for (const [complete, enabled] of [
      [vi.fn().mockResolvedValue('x'), false],
      [vi.fn().mockResolvedValue(null), true],
      [vi.fn().mockRejectedValue(new Error('vault is locked')), true],
    ] as const) {
      const view = setup(complete, enabled)
      type(view, ' ')
      await new Promise((r) => setTimeout(r, 40))
      expect(view.dom.querySelector('.cm-ai-ghost')).toBeNull()
      view.destroy()
    }
  })

  it('ignores a late answer after the text changed', async () => {
    let resolve!: (v: string) => void
    const view = setup(() => new Promise<string>((r) => (resolve = r)))
    type(view, ' ')
    await vi.waitFor(() => expect(resolve).toBeDefined())
    view.dispatch({ changes: { from: 0, insert: '// ' } })
    resolve(' = 1')
    await new Promise((r) => setTimeout(r, 20))
    expect(view.dom.querySelector('.cm-ai-ghost')).toBeNull()
    view.destroy()
  })
})
