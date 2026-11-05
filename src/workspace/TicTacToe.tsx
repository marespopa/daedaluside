import { useEffect, useState } from 'react'
import { aiMove, winner, type Cell } from './ticTacToeLogic'

/** A tiny game to pass the time while the workspace loads. You are X; the computer is O. */
export default function TicTacToe() {
  const [board, setBoard] = useState<Cell[]>(() => Array(9).fill(null))
  const win = winner(board)
  const full = board.every(Boolean)
  const over = win !== null || full
  const xTurn = board.filter(Boolean).length % 2 === 0

  useEffect(() => {
    if (over || xTurn) return
    const id = setTimeout(() => {
      setBoard((b) => {
        const next = [...b]
        const m = aiMove(b)
        if (m >= 0) next[m] = 'O'
        return next
      })
    }, 350)
    return () => clearTimeout(id)
  }, [over, xTurn, board])

  const play = (i: number) => {
    if (over || !xTurn || board[i]) return
    setBoard((b) => b.map((c, j) => (j === i ? 'X' : c)))
  }

  return (
    <div
      role="group"
      aria-label="Tic-tac-toe"
      className="flex flex-col items-center gap-2"
    >
      <div className="grid grid-cols-3 gap-1">
        {board.map((c, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Square ${i + 1}${c ? `, ${c}` : ''}`}
            disabled={over || !!c || !xTurn}
            onClick={() => play(i)}
            className="h-10 w-10 rounded border border-muted/40 font-mono text-sm text-text hover:bg-line/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none"
          >
            {c}
          </button>
        ))}
      </div>
      <p className="h-4 text-xs text-muted" role="status">
        {win ? (win === 'X' ? 'You win' : 'You lose') : full ? 'Draw' : ''}
      </p>
      {over && (
        <button
          type="button"
          onClick={() => setBoard(Array(9).fill(null))}
          className="rounded px-2 py-1 text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Play again
        </button>
      )}
    </div>
  )
}
