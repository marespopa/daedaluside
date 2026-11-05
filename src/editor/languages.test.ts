import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { findLanguage, loadLanguage } from './languages'

async function nodeNames(doc: string): Promise<Set<string>> {
  const lang = await loadLanguage('page.astro')
  const state = EditorState.create({ doc, extensions: [lang!.extension] })
  const tree = ensureSyntaxTree(state, doc.length, 5000)!
  const names = new Set<string>()
  tree.iterate({ enter: (n) => void names.add(n.name) })
  // Overlay mounts (the Astro frontmatter) are only visible by position, like the highlighter.
  for (let pos = 0; pos <= doc.length; pos++) names.add(tree.resolveInner(pos, 1).name)
  return names
}

describe('Astro language', () => {
  it('is picked by the .astro extension', () => {
    expect(findLanguage('src/pages/index.astro')?.name).toBe('Astro')
  })

  it('parses the frontmatter as TypeScript and the template as HTML', async () => {
    const names = await nodeNames(
      '---\nconst title: string = "hi"\n---\n<h1 class="x">{title}</h1>\n<script>let a = 1</script>\n',
    )
    expect(names.has('VariableDeclaration')).toBe(true) // frontmatter
    expect(names.has('TypeName')).toBe(true) // TypeScript-only syntax
    expect(names.has('Element')).toBe(true) // markup
    expect(names.has('Script')).toBe(true) // HTML's own <script> nesting still works
  })

  it('nests <script> content inside its Element', async () => {
    const doc = '<main><script>let a = 1</script></main>\n'
    const lang = await loadLanguage('page.astro')
    const state = EditorState.create({ doc, extensions: [lang!.extension] })
    const tree = ensureSyntaxTree(state, doc.length, 5000)!
    let parent: string | undefined
    tree.iterate({
      enter: (n) => void (n.name === 'Script' && (parent = n.node.parent?.name)),
    })
    expect(parent).toBe('Element')
    expect(tree.resolveInner(doc.indexOf('let'), 1).name).toBe('let')
  })

  it('treats a file without frontmatter as plain markup', async () => {
    const names = await nodeNames('<div>--- not frontmatter ---</div>\n')
    expect(names.has('Element')).toBe(true)
    expect(names.has('VariableDeclaration')).toBe(false)
  })
})
