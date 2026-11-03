import { unzipSync, zipSync, type Zippable } from 'fflate'
import { joinPath, normalizePath } from './path'
import { FSError, type Entry, type WorkspaceFS } from './types'

/** Folders that are never imported: huge, regenerable, and not useful as AI context. */
const IGNORED = new Set(['.git', 'node_modules', '__MACOSX'])
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024
export const MAX_IMPORT_FILES = 20_000

export type ImportEntry =
  | { kind: 'dir'; path: string }
  | { kind: 'file'; path: string; read: () => Promise<Uint8Array> }

const ignored = (path: string) => path.split('/').some((s) => IGNORED.has(s))

/** Every entry of the workspace, depth-first. One backend call, not one per directory. */
export function walkTree(fs: WorkspaceFS): Promise<Entry[]> {
  return fs.listAll()
}

export async function exportZip(fs: WorkspaceFS): Promise<Uint8Array> {
  const files: Zippable = {}
  for (const e of await walkTree(fs)) {
    // Trailing slash + empty data = directory entry, so empty folders survive.
    files[e.kind === 'dir' ? e.path + '/' : e.path] =
      e.kind === 'dir' ? new Uint8Array(0) : await fs.readBytes(e.path)
  }
  return zipSync(files, { level: 6 })
}

/** Throws on path traversal or oversize archives (zip bombs) before inflating anything. */
export function readZip(bytes: Uint8Array): ImportEntry[] {
  let total = 0
  let count = 0
  const raw = unzipSync(bytes, {
    filter: (f) => {
      if (++count > MAX_IMPORT_FILES)
        throw new FSError('EINVAL', 'Archive has too many files')
      total += f.originalSize
      if (total > MAX_IMPORT_BYTES) throw new FSError('EINVAL', 'Archive is too large')
      return !ignored(f.name)
    },
  })
  const out: ImportEntry[] = []
  for (const [name, data] of Object.entries(raw)) {
    const path = normalizePath(name) // rejects `..` (zip-slip)
    if (path === '') continue
    if (name.endsWith('/')) out.push({ kind: 'dir', path })
    else out.push({ kind: 'file', path, read: async () => data })
  }
  return out
}

/** From `<input webkitdirectory>`: drops the picked folder's own name. */
export function entriesFromFileList(files: Iterable<File>): {
  name: string
  entries: ImportEntry[]
} {
  let name = ''
  const entries: ImportEntry[] = []
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name
    const parts = rel.split('/')
    if (parts.length > 1) {
      name ||= parts[0] ?? ''
      parts.shift()
    }
    const path = normalizePath(parts.join('/'))
    if (path === '' || ignored(path)) continue
    entries.push({
      kind: 'file',
      path,
      read: async () => new Uint8Array(await f.arrayBuffer()),
    })
  }
  return { name, entries }
}

/** From `showDirectoryPicker()`. */
export async function entriesFromDirectoryHandle(
  root: FileSystemDirectoryHandle,
): Promise<ImportEntry[]> {
  const out: ImportEntry[] = []
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, h] of dir.entries()) {
      if (IGNORED.has(name)) continue
      const path = joinPath(prefix, name)
      if (h.kind === 'directory') {
        out.push({ kind: 'dir', path })
        await walk(h as FileSystemDirectoryHandle, path)
      } else {
        const fh = h as FileSystemFileHandle
        out.push({
          kind: 'file',
          path,
          read: async () => new Uint8Array(await (await fh.getFile()).arrayBuffer()),
        })
      }
    }
  }
  await walk(root, '')
  return out
}

export async function importEntries(
  fs: WorkspaceFS,
  entries: ImportEntry[],
): Promise<{ files: number; dirs: number }> {
  if (entries.length > MAX_IMPORT_FILES)
    throw new FSError('EINVAL', 'Too many files to import')
  let files = 0
  let dirs = 0
  for (const e of entries) {
    if (e.kind === 'dir') {
      await fs.mkdir(e.path)
      dirs++
    } else {
      await fs.writeBytes(e.path, await e.read())
      files++
    }
  }
  return { files, dirs }
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  type = 'application/zip',
) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
