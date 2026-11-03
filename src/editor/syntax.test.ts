import { createEditor, type EditorHandle } from './createEditor'

/** Finds the color CodeMirror declares for the class(es) on the span with this text. */
function colorOf(h: EditorHandle, text: string): string | undefined {
  const span = [...h.view.dom.querySelectorAll<HTMLElement>('.cm-line span')].find(
    (s) => s.textContent === text,
  )
  const classes = span?.className.trim().split(/\s+/) ?? []
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')
  for (const cls of classes) {
    const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css)
    const color = rule && /(?:^|;)\s*color:\s*([^;}]+)/.exec(rule[1]!)
    if (color) return color[1]!.trim()
  }
  return undefined
}

describe('syntax highlighting colors', () => {
  it('colors code tokens with the per-theme syntax tokens', async () => {
    const h = createEditor({
      parent: document.body,
      doc: 'const n = 42 // note\nconst s = "hi"',
    })
    expect(await h.setLanguage('main.ts')).toBe('TypeScript')
    expect(colorOf(h, 'const')).toBe('var(--syntax-keyword)')
    expect(colorOf(h, '42')).toBe('var(--syntax-number)')
    expect(colorOf(h, '"hi"')).toBe('var(--syntax-string)')
    expect(colorOf(h, '// note')).toBe('var(--syntax-comment)')
    h.destroy()
  })
})
