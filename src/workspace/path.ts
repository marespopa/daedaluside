import { FSError, type Entry } from './types'

/** Suffix for in-flight atomic writes. Hidden from listings. */
export const TMP_SUFFIX = '.daedalus-tmp'

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
  if (name.endsWith(TMP_SUFFIX)) {
    throw new FSError('EINVAL', `Reserved suffix: ${TMP_SUFFIX}`)
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

const encoder = new TextEncoder()
const decoder = new TextDecoder()
export const encodeText = (s: string) => encoder.encode(s)
export const decodeText = (b: Uint8Array) => decoder.decode(b)
