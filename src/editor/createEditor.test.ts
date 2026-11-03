import { syntaxTree } from '@codemirror/language'
import { createEditor } from './createEditor'

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
