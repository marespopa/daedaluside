import userEvent from '@testing-library/user-event'
import { createEditor } from './createEditor'
import { pathAt, pathCandidates, pathLinks } from './pathLinks'

describe('pathAt', () => {
  it('finds a path token and trims trailing punctuation', () => {
    const line = 'see `src/a/b.ts`, then x'
    expect(pathAt(line, line.indexOf('a/b'))).toBe('src/a/b.ts')
    expect(pathAt('open ./README.md.', 8)).toBe('./README.md')
  })

  it('ignores plain words, URLs and the space after a token', () => {
    expect(pathAt('plain words here', 7)).toBeNull()
    expect(pathAt('go https://x.com/a.md now', 12)).toBeNull()
    expect(pathAt('a.md  b', 5)).toBeNull()
  })
})

describe('pathCandidates', () => {
  it('tries the file folder, then the root', () => {
    expect(pathCandidates('x.ts', 'docs/a.md').slice(0, 2)).toEqual(['docs/x.ts', 'x.ts'])
    expect(pathCandidates('../src/x.ts', 'docs/a.md')[0]).toBe('src/x.ts')
    expect(pathCandidates('/src/x.ts', 'docs/a.md')[0]).toBe('src/x.ts')
    expect(pathCandidates('../../x.ts', 'a.md')).toEqual([])
  })

  it('resolves imports in code files like modules', () => {
    const c = pathCandidates('./workspace/controller', 'src/App.tsx')
    expect(c[0]).toBe('src/workspace/controller')
    expect(c).toContain('src/workspace/controller.ts')
    expect(c).toContain('src/workspace/controller/index.tsx')
    expect(pathCandidates('./a.js', 'src/b.ts')).toContain('src/a.ts')
    expect(pathCandidates('react', 'src/b.ts')).toEqual([])
    expect(pathCandidates('src/x.ts', 'src/b.ts')).toEqual([])
  })
})

describe('pathLinks extension', () => {
  function setup(enabled = true) {
    const onOpen = vi.fn()
    const h = createEditor({
      parent: document.body,
      doc: 'see src/a.ts',
      extensions: [pathLinks({ enabled: () => enabled, onOpen })],
    })
    // jsdom has no layout: pretend every pointer lands inside the path.
    h.view.posAtCoords = () => 6
    return { h, onOpen }
  }

  it('opens on double click and on ctrl+click', async () => {
    const { h, onOpen } = setup()
    const user = userEvent.setup()
    await user.dblClick(h.view.contentDOM)
    expect(onOpen).toHaveBeenCalledWith('src/a.ts')
    onOpen.mockClear()
    await user.keyboard('{Control>}')
    await user.click(h.view.contentDOM)
    await user.keyboard('{/Control}')
    expect(onOpen).toHaveBeenCalledTimes(1)
    h.destroy()
  })

  it('underlines the path while ctrl is held, if it may exist', async () => {
    const { h } = setup()
    const user = userEvent.setup()
    await user.keyboard('{Control>}')
    await user.pointer({ target: h.view.contentDOM, coords: { clientX: 1, clientY: 1 } })
    expect(h.view.dom.querySelector('.cm-path-link')?.textContent).toBe('src/a.ts')
    await user.keyboard('{/Control}')
    h.view.contentDOM.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    expect(h.view.dom.querySelector('.cm-path-link')).toBeNull()
    h.destroy()
  })

  it('does nothing when disabled', async () => {
    const { h, onOpen } = setup(false)
    await userEvent.setup().dblClick(h.view.contentDOM)
    expect(onOpen).not.toHaveBeenCalled()
    h.destroy()
  })
})
