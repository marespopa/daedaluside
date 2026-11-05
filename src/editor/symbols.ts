/** Text-based symbol helpers: no language service, so these are word-boundary heuristics. */

const WORD = /[\p{L}\p{N}_$]/u

/** The identifier touching `pos` in `text` (a single line), or null. */
export function wordRangeAt(
  text: string,
  pos: number,
): { from: number; to: number } | null {
  let from = pos
  let to = pos
  while (from > 0 && WORD.test(text[from - 1]!)) from--
  while (to < text.length && WORD.test(text[to]!)) to++
  if (from === to) return null
  if (/^\d/.test(text.slice(from, to))) return null
  return { from, to }
}

export function symbolAt(text: string, pos: number): string | null {
  const r = wordRangeAt(text, pos)
  return r ? text.slice(r.from, r.to) : null
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Identifier boundaries that also treat `$` and `_` as word characters. */
export function refPattern(name: string): string {
  return `(?<![\\p{L}\\p{N}_$])${escapeRegex(name)}(?![\\p{L}\\p{N}_$])`
}

export function refRegex(name: string, flags = 'gu'): RegExp {
  return new RegExp(refPattern(name), flags)
}

const KEYWORDS =
  '(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?' +
  '(?:function\\*?|class|interface|type|enum|namespace|const|let|var|def|fn|func|struct|trait|impl|object|module|record)'

/** Regex source matching a line that declares `name` (search with ripgrep-style engines). */
export function declarationPattern(name: string): string {
  const n = escapeRegex(name)
  return (
    `^\\s*${KEYWORDS}\\s+${n}(?![\\p{L}\\p{N}_$])` +
    `|^\\s*(?:(?:public|private|protected|static|readonly|async|get|set)\\s+)*${n}\\s*(?:\\([^)]*\\)\\s*(?::[^={]+)?\\{|[:=]\\s*(?:async\\s*)?(?:\\([^)]*\\)|\\w+)\\s*=>)`
  )
}

export function declarationRegex(name: string): RegExp {
  return new RegExp(declarationPattern(name), 'u')
}

/** True when `line` declares `name` (as opposed to calling it). */
export function isDeclarationLine(line: string, name: string): boolean {
  if (!declarationRegex(name).test(line)) return false
  // `foo(x) {` also matches `if (foo(x)) {`-style calls only when anchored at line start,
  // so control-flow keywords are the one false positive to rule out.
  return !/^\s*(?:if|for|while|switch|catch|return|else)\b/.test(line)
}

/** Whether the symbol at `col` on `line` is the declaration (vs. a call site). */
export function isDeclarationAt(line: string, col: number): boolean {
  const name = symbolAt(line, col)
  return name !== null && isDeclarationLine(line, name)
}
