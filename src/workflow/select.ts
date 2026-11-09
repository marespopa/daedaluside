import { computeHunks, type Hunk } from '../review/diff'
import { replaceLines } from '../review/stage'
import type { FilePatch } from './types'

/** The change hunks of a patch, in file order. A new file is one `add` hunk. */
export function patchHunks(patch: FilePatch): Hunk[] {
  return computeHunks(patch.base ?? '', patch.content)
}

/** The file text with only the hunks at `chosen` (indexes into `patchHunks`) applied. */
export function applyHunks(patch: FilePatch, chosen: ReadonlySet<number>): string {
  const hunks = patchHunks(patch)
  if (hunks.length > 0 && chosen.size >= hunks.length) return patch.content
  let out = patch.base ?? ''
  // Back to front, so the line positions of the hunks still to apply stay valid.
  for (let i = hunks.length - 1; i >= 0; i--) {
    const h = hunks[i]!
    if (chosen.has(i)) out = replaceLines(out, h.baseRange, patch.content, h.newRange)
  }
  return out
}

/**
 * The patches to apply after review. `choice` maps a path to its accepted hunk indexes; a path
 * missing from it counts as fully rejected. Patches left with no change are dropped.
 */
export function selectPatches(
  patches: readonly FilePatch[],
  choice: ReadonlyMap<string, ReadonlySet<number>>,
): FilePatch[] {
  const out: FilePatch[] = []
  for (const p of patches) {
    const chosen = choice.get(p.path)
    if (!chosen || chosen.size === 0) continue
    const content = applyHunks(p, chosen)
    if (content !== (p.base ?? '') || p.base === null) out.push({ ...p, content })
  }
  return out
}

/** Every hunk of every patch accepted: the default choice when review opens. */
export function acceptAll(patches: readonly FilePatch[]): Map<string, Set<number>> {
  return new Map(patches.map((p) => [p.path, new Set(patchHunks(p).keys())]))
}
