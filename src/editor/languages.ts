import type { Extension } from '@codemirror/state'
import {
  LanguageDescription,
  LanguageSupport,
  type LRLanguage,
} from '@codemirror/language'
import { languages as bundled } from '@codemirror/language-data'
import { parseMixed } from '@lezer/common'

/** `---` fenced frontmatter at the top of an Astro file. */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

const load = (name: string) => bundled.find((l) => l.name === name)!.load()

/**
 * Astro is not in language-data. Markup, `<script>` and `<style>` use the HTML grammar;
 * the frontmatter fence is parsed as TypeScript.
 */
const astro = LanguageDescription.of({
  name: 'Astro',
  extensions: ['astro'],
  async load() {
    const [html, ts] = await Promise.all([load('HTML'), load('TypeScript')])
    const tsParser = (ts.language as LRLanguage).parser
    const language = (html.language as LRLanguage).configure(
      {
        // Added to HTML's own wrapper (script/style), not a replacement for it.
        wrap: parseMixed((node, input) => {
          // Mount on the leading Text node: cursors do not descend into a root mount.
          if (node.name !== 'Text' || node.from !== 0) return null
          const m = FRONTMATTER.exec(input.read(0, Math.min(input.length, 50_000)))
          if (!m) return null
          const from = m[0].indexOf('\n') + 1
          const to = from + m[1]!.length
          return to > from ? { parser: tsParser, overlay: [{ from, to }] } : null
        }),
      },
      'astro',
    )
    return new LanguageSupport(language, [html.support])
  },
})

const languages = [astro, ...bundled]
export const languageList = languages

export function findLanguage(nameOrFile: string): LanguageDescription | null {
  return (
    LanguageDescription.matchFilename(languages, nameOrFile) ??
    languages.find((l) => l.name.toLowerCase() === nameOrFile.toLowerCase()) ??
    null
  )
}

/** Loads the parser on demand; resolves to [] for unknown languages or load failures. */
export async function loadLanguage(
  nameOrFile: string,
): Promise<{ name: string; extension: Extension } | null> {
  const desc = findLanguage(nameOrFile)
  if (!desc) return null
  try {
    const support = await desc.load()
    return { name: desc.name, extension: support }
  } catch {
    return null
  }
}
