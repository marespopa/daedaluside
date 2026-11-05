import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TicTacToe from './TicTacToe'
import { aiMove, winner } from './ticTacToeLogic'

describe('tic-tac-toe', () => {
  it('detects a winner', () => {
    expect(winner(['X', 'X', 'X', null, 'O', 'O', null, null, null])).toBe('X')
    expect(winner(Array(9).fill(null))).toBeNull()
  })

  it('the computer wins when it can, else blocks', () => {
    expect(aiMove(['O', 'O', null, 'X', 'X', null, null, null, null])).toBe(2)
    expect(aiMove(['X', 'X', null, null, 'O', null, null, null, null])).toBe(2)
  })

  it('answers a move with an O', async () => {
    const user = userEvent.setup()
    render(<TicTacToe />)
    await user.click(screen.getByRole('button', { name: 'Square 1' }))
    expect(await screen.findByRole('button', { name: 'Square 5, O' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Square 1, X' })).toBeDisabled()
  })
})
