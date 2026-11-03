import { undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { getCM, Vim } from '@replit/codemirror-vim'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VimStatus } from '../state/editorAtoms'
import { createEditor, type EditorHandle } from './createEditor'
import { runEx } from './testing/runEx'
import { bindVimHost, openExPrompt, vimModeLabel } from './vimMode'
import { loadVimEnabled } from '../state/editorAtoms'

function fakeHost() {
  return {
    save: vi.fn(),
    close: vi.fn(),
    discard: vi.fn(),
    open: vi.fn(),
    cycle: vi.fn(),
    explore: vi.fn(),
    notify: vi.fn(),
    status: vi.fn(),
  }
}

let handles: EditorHandle[] = []
function editor(doc = 'hello world') {
  const h = createEditor({ parent: document.body, doc })
  handles.push(h)
  return h
}

afterEach(() => {
  handles.forEach((h) => h.destroy())
  handles = []
  bindVimHost(null)
})

describe('vim mode toggle', () => {
  it('turns Vim on and off without touching the document, selection or undo history', () => {
    const h = editor('one')
    h.view.dispatch({ changes: { from: 3, insert: ' two' } })
    h.view.dispatch({ selection: EditorSelection.cursor(2) })

    h.setVim(true)
    expect(getCM(h.view)).not.toBeNull()
    expect(h.view.state.selection.main.head).toBe(2)

    h.setVim(false)
    expect(getCM(h.view)).toBeNull()
    expect(h.view.state.doc.toString()).toBe('one two')

    undo(h.view)
    expect(h.view.state.doc.toString()).toBe('one')
  })

  it('brings a stashed state in line with the current setting when it is shown', () => {
    const h = editor()
    h.setVim(false)
    const off = h.createState('off')
    h.setVim(true)
    h.setState(off)
    expect(getCM(h.view)).not.toBeNull()

    const on = h.createState('on')
    h.setVim(false)
    h.setState(on)
    expect(getCM(h.view)).toBeNull()
  })

  it('leaves a state without the Vim compartment alone', () => {
    const h = editor()
    h.setVim(true)
    h.setState(EditorState.create({ doc: 'bare' }))
    expect(getCM(h.view)).toBeNull()
    expect(h.view.state.doc.toString()).toBe('bare')
  })
})

describe('vim keys', () => {
  it('is on by default, and remembers being turned off', () => {
    expect(loadVimEnabled()).toBe(true)
    localStorage.setItem('daedalus.vimMode', 'off')
    expect(loadVimEnabled()).toBe(false)
    localStorage.removeItem('daedalus.vimMode')
  })

  it('opens the Ex prompt programmatically on the blank-page editor', () => {
    const host = fakeHost()
    bindVimHost(host)
    const h = editor()
    h.setVim(true)

    expect(openExPrompt(h.view)).toBe(true)
    expect(document.querySelector('.cm-vim-panel input')).not.toBeNull()
    expect(host.status).toHaveBeenLastCalledWith({ label: 'NORMAL', prompt: true })
  })

  it('maps jk to Escape in insert mode', () => {
    const host = fakeHost()
    bindVimHost(host)
    const h = editor('')
    h.setVim(true)
    const cm = getCM(h.view)!
    Vim.handleKey(cm, 'i', 'user')
    Vim.handleKey(cm, 'j', 'user')
    Vim.handleKey(cm, 'k', 'user')
    expect(h.view.state.doc.toString()).toBe('')
    expect(host.status).toHaveBeenLastCalledWith({ label: 'NORMAL', prompt: false })
  })

  it('lets Mod-B and Mod-K reach the window instead of Vim', () => {
    const h = editor()
    h.setVim(true)
    const reached = vi.fn()
    window.addEventListener('keydown', reached)
    for (const [key, code] of [
      ['b', 'KeyB'],
      ['k', 'KeyK'],
    ] as const) {
      const chord = new KeyboardEvent('keydown', {
        key,
        code,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      h.view.contentDOM.dispatchEvent(chord)
      expect(reached).toHaveBeenCalledWith(chord)
    }
    window.removeEventListener('keydown', reached)
  })

  it('still gives Vim its own control keys', () => {
    const h = editor()
    h.setVim(true)
    const halfPage = new KeyboardEvent('keydown', {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    h.view.contentDOM.dispatchEvent(halfPage)
    expect(halfPage.defaultPrevented).toBe(true)
  })
})

describe('mode footnote', () => {
  it('reports the mode as it changes', () => {
    const host = fakeHost()
    bindVimHost(host)
    const h = editor()
    h.setVim(true)
    const cm = getCM(h.view)!
    const last = () => host.status.mock.lastCall?.[0] as VimStatus

    expect(last()).toEqual({ label: 'NORMAL', prompt: false })
    Vim.handleKey(cm, 'i', 'user')
    expect(last().label).toBe('INSERT')
    Vim.handleKey(cm, '<Esc>', 'user')
    expect(last().label).toBe('NORMAL')
    Vim.handleKey(cm, 'v', 'user')
    expect(last().label).toBe('VISUAL')
    Vim.handleKey(cm, '<Esc>', 'user')
  })

  it('maps visual sub-modes to V-LINE and V-BLOCK', () => {
    expect(vimModeLabel({ mode: 'visual', subMode: 'linewise' })).toBe('V-LINE')
    expect(vimModeLabel({ mode: 'visual', subMode: 'blockwise' })).toBe('V-BLOCK')
    expect(vimModeLabel({ mode: 'visual', subMode: '' })).toBe('VISUAL')
    expect(vimModeLabel({ mode: 'replace' })).toBe('REPLACE')
  })
})

describe('Ex commands', () => {
  function run(h: EditorHandle, line: string) {
    runEx(h.view, line)
  }

  it('opens the file tree with the netrw drawer commands', () => {
    const host = fakeHost()
    bindVimHost(host)
    const h = editor()
    h.setVim(true)

    for (const command of ['Explore', 'Ex', 'E', 'explore', 'Sexplore', 'Vexplore'])
      run(h, command)
    expect(host.explore).toHaveBeenCalledTimes(6)
  })

  it('maps :w, :q, :wq and :bd to the workspace host', () => {
    const host = fakeHost()
    bindVimHost(host)
    const h = editor()
    h.setVim(true)

    run(h, 'w')
    expect(host.save).toHaveBeenCalledOnce()

    run(h, 'q')
    run(h, 'wq')
    run(h, 'bd')
    expect(host.close).toHaveBeenCalledTimes(3)
    expect(host.discard).not.toHaveBeenCalled()
  })

  it(':q! and :bd! discard instead of saving', () => {
    const host = fakeHost()
    bindVimHost(host)
    const h = editor()
    h.setVim(true)

    run(h, 'q!')
    run(h, 'bd!')
    expect(host.discard).toHaveBeenCalledTimes(2)
    expect(host.close).not.toHaveBeenCalled()
    expect(host.save).not.toHaveBeenCalled()
  })

  it(':e opens a file by name, and :bn and :bp cycle tabs', () => {
    const host = fakeHost()
    bindVimHost(host)
    const h = editor()
    h.setVim(true)

    run(h, 'e notes.md')
    expect(host.open).toHaveBeenCalledWith('notes.md')
    run(h, 'bn')
    run(h, 'bp')
    expect(host.cycle).toHaveBeenNthCalledWith(1, 1)
    expect(host.cycle).toHaveBeenNthCalledWith(2, -1)
  })

  it('refuses to write to another file', () => {
    const host = fakeHost()
    bindVimHost(host)
    const h = editor()
    h.setVim(true)

    run(h, 'w other.txt')
    expect(host.save).not.toHaveBeenCalled()
    expect(host.notify).toHaveBeenCalledWith('Writing to another file is not supported')
  })
})
