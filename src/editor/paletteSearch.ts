import type { Entry } from '../workspace/types'

/**
 * A new file or folder to create. With no `parent` the palette first asks for the
 * location; with one it asks for the name.
 */
export interface NewEntryRequest {
  kind: 'file' | 'folder'
  parent?: string
}

export interface PaletteItem {
  id: string
  label: string
  /** Runs the command and closes the palette. */
  run?: () => void
  /** Starts a create flow in the open palette instead of running at once. */
  enter?: NewEntryRequest
}

/** A leading `>` switches the palette to commands, as in VS Code. */
export const COMMAND_PREFIX = '>'
export const FILE_RESULT_LIMIT = 50

export type PaletteMode = 'files' | 'commands'

export function paletteMode(query: string): PaletteMode {
  return query.startsWith(COMMAND_PREFIX) ? 'commands' : 'files'
}

/** The search text: the query without the mode prefix, trimmed and lowercased. */
export function paletteNeedle(query: string): string {
  const text =
    paletteMode(query) === 'commands' ? query.slice(COMMAND_PREFIX.length) : query
  return text.trim().toLowerCase()
}

const words = (needle: string) => needle.toLowerCase().split(/\s+/).filter(Boolean)

/** Every word of the needle must appear in the label. An empty needle matches all. */
export function matchCommands(commands: readonly PaletteItem[], needle: string) {
  const ws = words(needle)
  if (ws.length === 0) return [...commands]
  return commands.filter((c) => {
    const label = c.label.toLowerCase()
    return ws.every((w) => label.includes(w))
  })
}

const lowerPaths = new WeakMap<Entry, string>()
/** Lowercased path, computed once per entry rather than once per keystroke. */
const lowerPath = (e: Entry) => {
  let p = lowerPaths.get(e)
  if (p === undefined) lowerPaths.set(e, (p = e.path.toLowerCase()))
  return p
}

/** True when the letters of `word` appear in `text` in order (not necessarily adjacent). */
function isSubsequence(word: string, text: string): boolean {
  let at = 0
  for (let i = 0; i < text.length && at < word.length; i++) {
    if (text.charCodeAt(i) === word.charCodeAt(at)) at++
  }
  return at === word.length
}

const isGlob = (w: string) => /[*?]/.test(w)

/**
 * A glob word (`*.css`, `test?.ts`) as a regex. Without a `/` it must match the whole
 * file name; with one it must match the whole path.
 */
function globMatcher(word: string): (path: string, name: string) => boolean {
  const source = word
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  const re = new RegExp(`^${source}$`)
  const onPath = word.includes('/')
  return (path, name) => re.test(onPath ? path : name)
}

/**
 * File search by path. Every word must appear in the path. Matches on the file name
 * rank first, then shorter paths; with `fuzzy`, paths that only contain the letters in
 * order (`fctl` for `file-controller`) follow every substring match. Returns at most
 * `limit` entries.
 */
export function matchFiles(
  files: readonly Entry[],
  needle: string,
  limit = FILE_RESULT_LIMIT,
  fuzzy = true,
): Entry[] {
  const ws = words(needle)
  if (ws.length === 0) return files.slice(0, limit)
  const hits: { entry: Entry; rank: number }[] = []
  const tests = ws.map((w) =>
    isGlob(w) ? globMatcher(w) : (path: string) => path.includes(w),
  )
  for (const entry of files) {
    const path = lowerPath(entry)
    const name = entry.name.toLowerCase()
    const exact = tests.every((t) => t(path, name))
    if (exact) {
      hits.push({
        entry,
        rank: ws.every((w) => isGlob(w) || name.includes(w)) ? 0 : 1,
      })
    } else if (fuzzy && ws.every((w) => !isGlob(w) && isSubsequence(w, path))) {
      hits.push({ entry, rank: 2 })
    }
  }
  hits.sort((a, b) => a.rank - b.rank || a.entry.path.length - b.entry.path.length)
  return hits.slice(0, limit).map((h) => h.entry)
}
