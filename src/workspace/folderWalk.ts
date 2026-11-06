import { joinPath } from './path'
import { NO_RULES, parseGitignoreDirs, skipsDir, type DirRules } from './ignore'
import type { Entry } from './types'

/** Folders that are never imported: huge, regenerable, and not useful as AI context. */
export const IGNORED = new Set(['.git', 'node_modules', '__MACOSX'])

/** At most this many handle calls (directory reads, `getFile` stats) are in flight at once. */
const WALK_CONCURRENCY = 32

function isPermissionError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'NotAllowedError' || e.name === 'SecurityError')
  )
}

function limiter(max: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => waiting.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

export interface WalkHandlers {
  /** Entries of one directory, as soon as that directory is read. Unsorted across directories. */
  onChunk?: ((entries: Entry[]) => void) | undefined
  /** Running entry count. */
  onProgress?: ((count: number) => void) | undefined
}

/**
 * Reads a whole folder tree: sibling directories in parallel and each directory's
 * file sizes in parallel, with a bound on in-flight handle calls. Read-only, so it does
 * not need to wait behind writes. Returns every entry, unsorted.
 */
export async function walkFolder(
  root: FileSystemDirectoryHandle,
  { onChunk, onProgress }: WalkHandlers = {},
): Promise<Entry[]> {
  const out: Entry[] = []
  const run = limiter(WALK_CONCURRENCY)
  let failed = false
  let rules: DirRules = NO_RULES
  try {
    const f = await (await root.getFileHandle('.gitignore')).getFile()
    rules = parseGitignoreDirs(await f.text())
  } catch (e) {
    if (isPermissionError(e)) throw e // no .gitignore (or unreadable): only the defaults apply
  }

  const visit = async (dir: FileSystemDirectoryHandle, path: string): Promise<void> => {
    const files: { name: string; handle: FileSystemFileHandle }[] = []
    const dirs: { name: string; handle: FileSystemDirectoryHandle }[] = []
    try {
      await run(async () => {
        for await (const [name, h] of dir.entries()) {
          if (h.kind === 'file') files.push({ name, handle: h as FileSystemFileHandle })
          else if (!IGNORED.has(name) && !skipsDir(name, joinPath(path, name), rules))
            dirs.push({ name, handle: h as FileSystemDirectoryHandle })
        }
      })
    } catch (e) {
      // One unreadable directory must not empty the whole tree; the root still fails.
      if (path === '' || isPermissionError(e)) throw e
    }
    const chunk: Entry[] = await Promise.all(
      files.map(({ name, handle }) =>
        run(async (): Promise<Entry> => {
          let size = 0
          let mtime: number | undefined
          try {
            const f = await handle.getFile()
            size = f.size
            mtime = f.lastModified
          } catch (e) {
            // A lost grant must surface as a permission problem; anything else
            // (a file that vanished mid-scan) still lists the file.
            if (isPermissionError(e)) throw e
          }
          const entry: Entry = { name, path: joinPath(path, name), kind: 'file', size }
          if (typeof mtime === 'number') entry.mtime = mtime
          return entry
        }),
      ),
    )
    for (const { name } of dirs)
      chunk.push({ name, path: joinPath(path, name), kind: 'dir' })
    if (failed) return
    out.push(...chunk)
    if (chunk.length > 0) onChunk?.(chunk)
    onProgress?.(out.length)
    await Promise.all(dirs.map(({ name, handle }) => visit(handle, joinPath(path, name))))
  }

  try {
    await visit(root, '')
  } catch (e) {
    failed = true
    throw e
  }
  return out
}
