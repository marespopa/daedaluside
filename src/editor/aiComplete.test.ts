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
