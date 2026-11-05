export type Cell = 'X' | 'O' | null

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

export function winner(b: readonly Cell[]): Cell {
  for (const [a, c, d] of LINES) {
    const v = b[a]
    if (v && v === b[c] && v === b[d]) return v
  }
  return null
}

/** Picks a square for O: win, else block X, else centre, else a random free square. */
export function aiMove(b: readonly Cell[]): number {
  const free = b.flatMap((c, i) => (c ? [] : [i]))
  for (const who of ['O', 'X'] as const) {
    const hit = free.find((i) => winner(b.map((c, j) => (j === i ? who : c))) === who)
    if (hit !== undefined) return hit
  }
  if (b[4] === null) return 4
  return free[Math.floor(Math.random() * free.length)] ?? -1
}
