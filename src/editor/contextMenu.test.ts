import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { symbolTriggers } from './contextMenu'
import { contextMenuItems } from './contextMenuItems'
import { createEditor } from './createEditor'

function setup(enabled = true) {
  const onMenu = vi.fn()
  const onAction = vi.fn()
  const h = createEditor({
    parent: document.body,
    doc: 'function run() {}\nx = run()',
    extensions: [symbolTriggers({ enabled: () => enabled, onMenu, onAction })],
  })
  // jsdom has no layout: the pointer lands on "run" in line 2.
  h.view.posAtCoords = () => 22
  return { h, onMenu, onAction }
}

describe('symbolTriggers', () => {
  it('right-click moves the caret under the pointer and opens the menu', () => {
    const { h, onMenu } = setup()
    fireEvent.contextMenu(h.view.contentDOM, { clientX: 10, clientY: 20 })
    expect(h.view.state.selection.main.head).toBe(22)
    expect(onMenu).toHaveBeenCalledWith({ x: 10, y: 20 })
    h.destroy()
  })

  it('opens on Shift+F10 and the Menu key', () => {
    const { h, onMenu } = setup()
    fireEvent.keyDown(h.view.contentDOM, { key: 'F10', shiftKey: true })
    fireEvent.keyDown(h.view.contentDOM, { key: 'ContextMenu' })
    expect(onMenu).toHaveBeenCalledTimes(2)
    h.destroy()
  })

  it('maps F12, Shift+F12, Alt+F12 and F2 to actions', async () => {
    const { h, onAction } = setup()
    const user = userEvent.setup()
    h.view.focus()
    await user.keyboard('{F12}{Shift>}{F12}{/Shift}{Alt>}{F12}{/Alt}{F2}')
    expect(onAction.mock.calls.map((c) => c[0])).toEqual([
      'definition',
      'references',
      'peek',
      'rename',
    ])
    h.destroy()
  })

  it('does nothing while disabled', () => {
    const { h, onMenu } = setup(false)
    fireEvent.contextMenu(h.view.contentDOM)
    expect(onMenu).not.toHaveBeenCalled()
    h.destroy()
  })
})

describe('contextMenuItems', () => {
  const base = { symbol: 'run', onDeclaration: false, hasSelection: false, run: vi.fn() }
  const ids = (o: Partial<typeof base>) =>
    contextMenuItems({ ...base, ...o }).map((i) => i.id)

  it('leads with definition at a call site and references on a declaration', () => {
    expect(ids({})[0]).toBe('definition')
    expect(ids({ onDeclaration: true })[0]).toBe('references')
  })

  it('stays within 7 items, adds Extract only for a selection', () => {
    expect(ids({}).length).toBeLessThanOrEqual(7)
    expect(ids({ onDeclaration: true, hasSelection: true }).length).toBeLessThanOrEqual(7)
    expect(ids({})).not.toContain('extract')
    expect(ids({ hasSelection: true })).toContain('extract')
  })

  it('disables symbol actions without a symbol, and marks unavailable ones with text', () => {
    const items = contextMenuItems({ ...base, symbol: null })
    expect(items.find((i) => i.id === 'rename')?.disabled).toBe(true)
    expect(items.find((i) => i.id === 'hover')?.note).toBeTruthy()
  })

  it('separates the three groups', () => {
    const items = contextMenuItems(base)
    expect(items.filter((i) => i.separator)).toHaveLength(2)
  })
})
