import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { THEMES } from '../lib/themes'

// Parses the token CSS directly so the contrast check reads the same values the
// browser uses. Vitest does not return raw CSS for `?raw` imports, so read from
// disk; vitest runs from the project root.
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

function block(id: string): string {
  const start = css.indexOf(`[data-theme='${id}'] {`)
  if (start < 0) throw new Error(`missing theme block ${id}`)
  return css.slice(start, css.indexOf('}', start))
}

/** Plain hex tokens only; color-mix() tints and numbers are derived elsewhere. */
function tokens(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of source.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]!] = m[2]!.toLowerCase()
  }
  return out
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// Text pairs need WCAG AA (4.5:1). Accent is used as a non-text indicator
// (cursor, tab underline), so it needs 3:1.
const pairs: [string, string, number][] = [
  ['text', 'canvas', 4.5],
  ['text', 'surface', 4.5],
  ['muted', 'canvas', 4.5],
  ['muted', 'surface', 4.5],
  ['diff-add-fg', 'canvas', 4.5],
  ['diff-remove-fg', 'canvas', 4.5],
  ['accent', 'canvas', 3],
  // The change marker is a non-text indicator, like accent.
  ['diff-change-fg', 'canvas', 3],
]

// Code colors are read as text, so every one needs AA on both backgrounds.
const SYNTAX = [
  'syntax-keyword',
  'syntax-string',
  'syntax-number',
  'syntax-function',
  'syntax-type',
  'syntax-property',
  'syntax-comment',
]
const syntaxPairs: [string, string, number][] = SYNTAX.flatMap((fg) => [
  [fg, 'canvas', 4.5],
  [fg, 'surface', 4.5],
])

describe.each(THEMES.map((t) => [t.id, t.kind] as const))('%s theme', (id, kind) => {
  const t = tokens(block(id))
  it.each([...pairs, ...syntaxPairs])(
    '%s on %s meets the required ratio %s:1',
    (fg, bg, min) => {
      expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min)
    },
  )
  it(`declares color-scheme ${kind}`, () => {
    expect(block(id)).toContain(`color-scheme: ${kind}`)
  })
  it('defines the full token set', () => {
    expect(Object.keys(t).sort()).toEqual(
      [
        'accent',
        'canvas',
        'diff-add-fg',
        'diff-change-fg',
        'diff-remove-fg',
        'line',
        'muted',
        'surface',
        'text',
        ...SYNTAX,
      ].sort(),
    )
  })
})

describe('no raw colors in components', () => {
  it('uses semantic tokens only in src/**/*.tsx', () => {
    const files = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const offenders = Object.entries(files)
      .filter(([, src]) => /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.test(src))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
