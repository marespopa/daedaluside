import { FSError, type Entry } from './types'

/** Normalizes to `a/b/c`; '' is the root. Rejects `.`/`..` segments and bad names. */
export function normalizePath(input: string): string {
  const parts = input.split('/').filter((p) => p !== '')
  for (const p of parts) validateName(p)
  return parts.join('/')
}

export function validateName(name: string): void {
  if (name === '.' || name === '..' || name.includes('\0') || name.includes('\\')) {
    throw new FSError('EINVAL', `Invalid name: ${JSON.stringify(name)}`)
  }
}

export function splitPath(path: string): string[] {
  return path === '' ? [] : path.split('/')
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function joinPath(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/')
}

/** True if `path` equals `ancestor` or lies inside it. The root contains everything. */
export function isWithin(path: string, ancestor: string): boolean {
  return ancestor === '' || path === ancestor || path.startsWith(ancestor + '/')
}

export function compareEntries(
  a: { name: string; kind: string },
  b: { name: string; kind: string },
): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * Orders a flat list of entries depth-first: each directory is followed by its
 * descendants, siblings in `compareEntries` order. Entries whose parent is not in
 * the list (other than the root) are dropped.
 */
export function depthFirst(entries: readonly Entry[]): Entry[] {
  const byParent = new Map<string, Entry[]>()
  for (const e of entries) {
    const p = dirname(e.path)
    const list = byParent.get(p)
    if (list) list.push(e)
    else byParent.set(p, [e])
  }
  const out: Entry[] = []
  const visit = (dir: string) => {
    for (const e of (byParent.get(dir) ?? []).sort(compareEntries)) {
      out.push(e)
      if (e.kind === 'dir') visit(e.path)
    }
  }
  visit('')
  return out
}

/**
 * Inserts a depth-first block (an entry followed by its descendants, in order) below
 * `parent`, at its sorted position among the parent's children. Directory entries the
 * block hangs from that are still missing are added first (a rename or a write may have
 * created them on disk). Returns null when an ancestor exists as a file: the caller
 * should fall back to a full refresh instead of guessing.
 */
function insertBlock(
  entries: readonly Entry[],
  block: readonly Entry[],
  firstPath: string,
): Entry[] | null {
  for (let dir = dirname(firstPath); dir !== ''; dir = dirname(dir)) {
    const ancestor = entries.find((e) => e.path === dir)
    if (!ancestor) {
      const grown = addEntry(entries, { name: basename(dir), path: dir, kind: 'dir' })
      if (!grown) return null
      entries = grown
    } else if (ancestor.kind !== 'dir') {
      return null
    }
  }
  const out = [...entries]
  const parent = dirname(firstPath)
  // Start right after the parent (it exists: the ancestor loop above added it; the
  // root's children start at 0). Siblings sit in a depth-first run, so skipping to the
  // next sibling must skip that sibling's whole subtree, not just its own row.
  const at = (parent === '' ? -1 : out.findIndex((e) => e.path === parent)) + 1
  let i = at
  while (i < out.length) {
    const e = out[i]!
    if (dirname(e.path) !== parent) break // past the parent's children
    if (compareEntries(e, block[0]!) > 0) break // the block sorts before this sibling
    i++
    while (i < out.length && isWithin(out[i]!.path, e.path)) i++
  }
  out.splice(i, 0, ...block)
  return out
}

/** Adds a single entry (a new file or folder) in sorted position. */
export function addEntry(entries: readonly Entry[], e: Entry): Entry[] | null {
  if (entries.some((x) => x.path === e.path)) return null
  return insertBlock(entries, [e], e.path)
}

/** Prefix-rewrites a renamed subtree and moves the block into place (see insertBlock). */
export function renameEntries(
  entries: readonly Entry[],
  from: string,
  to: string,
): Entry[] | null {
  if (from === to) return [...entries]
  const at = entries.findIndex((e) => e.path === from)
  if (at < 0) return null
  // A subtree is one contiguous depth-first run, so the block splits off by length.
  let end = at + 1
  while (end < entries.length && isWithin(entries[end]!.path, from)) end++
  const block = entries.slice(at, end).map((e) => {
    const path = to + e.path.slice(from.length)
    // The name must follow the path, or rows would show stale names after a rename.
    return { ...e, path, name: basename(path) }
  })
  const rest = [...entries.slice(0, at), ...entries.slice(end)]
  return insertBlock(rest, block, to)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
export const encodeText = (s: string) => encoder.encode(s)
export const decodeText = (b: Uint8Array) => decoder.decode(b)
