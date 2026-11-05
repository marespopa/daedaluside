import type { GrepHit } from '../workspace/grep'
import { isDeclarationLine, refRegex } from './symbols'

export interface SymbolHit extends GrepHit {
  declaration: boolean
}

export interface SymbolResult {
  refs: SymbolHit[]
  definitions: SymbolHit[]
  truncated: boolean
}

type Grep = (
  query: string,
  onBatch: (hits: GrepHit[]) => void,
  onDone: (truncated: boolean) => void,
) => () => void

/**
 * Text-based symbol lookup over the workspace grep: literal substring search, then keep
 * whole-identifier hits. `activePath` sorts same-file hits first.
 */
export function searchSymbol(
  grep: Grep,
  name: string,
  activePath: string | null,
): { result: Promise<SymbolResult>; cancel: () => void } {
  let cancel = () => {}
  const result = new Promise<SymbolResult>((resolve) => {
    const refs: SymbolHit[] = []
    const word = refRegex(name, 'u')
    cancel = grep(
      name,
      (hits) => {
        for (const h of hits) {
          if (!word.test(h.text)) continue
          refs.push({
            ...h,
            declaration: h.start === 0 && isDeclarationLine(h.text, name),
          })
        }
      },
      (truncated) => {
        refs.sort(
          (a, b) =>
            Number(b.path === activePath) - Number(a.path === activePath) ||
            a.path.localeCompare(b.path) ||
            a.line - b.line,
        )
        resolve({ refs, definitions: refs.filter((h) => h.declaration), truncated })
      },
    )
  })
  return { result, cancel }
}
