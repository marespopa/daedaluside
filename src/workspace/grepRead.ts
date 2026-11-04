import { looksBinary, MAX_FILE_BYTES } from './grep'
import { splitPath } from './path'

/** What reading one file for the index produced. */
export interface ReadResult {
  path: string
  /** Bytes on disk; what the index budget counts. */
  size: number
  /** Decoded text, or null when the file is empty, too large, binary or unreadable. */
  text: string | null
}

/**
 * Reads `path` below a folder handle and decodes it for the index. Used by the grep
 * worker (and the in-process backend), so the main thread never touches file bytes.
 */
export async function readForIndex(
  root: FileSystemDirectoryHandle,
  path: string,
  decoder = new TextDecoder(),
): Promise<ReadResult> {
  try {
    let dir = root
    const parts = splitPath(path)
    const name = parts.pop()
    if (name === undefined) return { path, size: 0, text: null }
    for (const p of parts) dir = await dir.getDirectoryHandle(p)
    const file = await (await dir.getFileHandle(name)).getFile()
    if (file.size === 0 || file.size > MAX_FILE_BYTES)
      return { path, size: file.size, text: null }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (looksBinary(bytes)) return { path, size: bytes.length, text: null }
    return { path, size: bytes.length, text: decoder.decode(bytes) }
  } catch {
    return { path, size: -1, text: null } // vanished or unreadable: the next sync retries
  }
}
