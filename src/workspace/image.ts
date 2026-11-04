/**
 * Image files the editor can display (read-only). Display is deliberately narrow:
 * an extension allowlist, a content check, and a MIME type chosen here, never taken
 * from the file. SVG is active content, so it must only ever reach an `<img>` (which
 * runs no script and loads no external resources), never the DOM.
 */
export type ImageKind = 'png' | 'jpeg' | 'svg'

const MIME: Record<ImageKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
}

export function imageKind(path: string): ImageKind | null {
  const m = /\.([^./]+)$/.exec(path)
  switch (m?.[1]?.toLowerCase()) {
    case 'png':
      return 'png'
    case 'jpg':
    case 'jpeg':
      return 'jpeg'
    case 'svg':
      return 'svg'
    default:
      return null
  }
}

export function imageMime(kind: ImageKind): string {
  return MIME[kind]
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b)
}

/** An SVG document: optional BOM, XML declaration, comments and DOCTYPE, then `<svg`. */
const SVG_HEAD =
  /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i

/** True when the bytes really are the claimed format. */
export function sniffImage(kind: ImageKind, bytes: Uint8Array): boolean {
  switch (kind) {
    case 'png':
      return startsWith(bytes, PNG)
    case 'jpeg':
      return startsWith(bytes, JPEG)
    case 'svg': {
      if (bytes.includes(0)) return false
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return SVG_HEAD.test(text)
      } catch {
        return false
      }
    }
  }
}
