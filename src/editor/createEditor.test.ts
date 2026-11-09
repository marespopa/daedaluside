import { foldedRanges, foldAll, syntaxTree, unfoldAll } from '@codemirror/language'
import { createEditor, LARGE_FILE_CHARS } from './createEditor'

describe('createEditor', () => {
  it('creates a view with the given doc', () => {
    const h = createEditor({ parent: document.body, doc: 'hello' })
    expect(h.view.state.doc.toString()).toBe('hello')
    h.destroy()
  })

  it('lazily loads a language', async () => {
    const h = createEditor({ parent: document.body, doc: 'const a = 1' })
    expect(syntaxTree(h.view.state).length).toBe(0)
    expect(await h.setLanguage('main.ts')).toBe('TypeScript')
    expect(syntaxTree(h.view.state).length).toBeGreaterThan(0)
    expect(await h.setLanguage('nope.unknownext')).toBeNull()
    h.destroy()
  })
})

describe('section collapse', () => {
  const src = 'function a() {\n  return 1\n}\nfunction b() {\n  return 2\n}\n'

  it('shows a fold gutter and folds and unfolds every section', async () => {
    const h = createEditor({ parent: document.body, doc: src, filename: 'main.ts' })
    await h.setLanguage('main.ts')
    expect(h.view.dom.querySelector('.cm-foldGutter')).not.toBeNull()
    foldAll(h.view)
    expect(foldedRanges(h.view.state).size).toBe(2)
    unfoldAll(h.view)
    expect(foldedRanges(h.view.state).size).toBe(0)
    h.destroy()
  })

  it('has no fold gutter in large-file mode', () => {
    const h = createEditor({
      parent: document.body,
      doc: 'x'.repeat(LARGE_FILE_CHARS + 1),
    })
    expect(h.view.dom.querySelector('.cm-foldGutter')).toBeNull()
    h.destroy()
  })
})

describe('large-file mode', () => {
  it('keeps wrapping for normal documents', () => {
    const h = createEditor({ parent: document.body, doc: 'small' })
    expect(h.view.lineWrapping).toBe(true)
    h.destroy()
  })

  it('drops wrapping for a large document, and each state keeps its own setting', () => {
    const h = createEditor({ parent: document.body })
    const small = h.createState('small')
    const large = h.createState('x'.repeat(LARGE_FILE_CHARS + 1))
    h.setState(large)
    expect(h.view.lineWrapping).toBe(false)
    h.setState(small)
    expect(h.view.lineWrapping).toBe(true)
    h.setState(large)
    expect(h.view.lineWrapping).toBe(false)
    h.destroy()
  })
})
