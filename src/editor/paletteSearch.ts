import type { Entry } from '../workspace/types'

export interface PaletteItem {
  id: string
  label: string
  run: () => void
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

/**
 * File search by path. Every word must appear in the path. Matches on the file name
 * rank first, then shorter paths. Returns at most `limit` entries.
 */
export function matchFiles(
  files: readonly Entry[],
  needle: string,
  limit = FILE_RESULT_LIMIT,
): Entry[] {
  const ws = words(needle)
  if (ws.length === 0) return files.slice(0, limit)
  const hits: { entry: Entry; rank: number }[] = []
  for (const entry of files) {
    if (!ws.every((w) => entry.path.toLowerCase().includes(w))) continue
    const name = entry.name.toLowerCase()
    hits.push({ entry, rank: ws.every((w) => name.includes(w)) ? 0 : 1 })
  }
  hits.sort((a, b) => a.rank - b.rank || a.entry.path.length - b.entry.path.length)
  return hits.slice(0, limit).map((h) => h.entry)
}
