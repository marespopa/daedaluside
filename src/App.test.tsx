import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App', () => {
  it('renders the editor with no visible chrome', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: 'Daedalus IDE', hidden: true }),
    ).toHaveClass('sr-only')
    expect(screen.getByRole('textbox', { name: 'Editor' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the palette with Mod-K and switches theme', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Control>}k{/Control}')
    const input = screen.getByRole('combobox')
    expect(input).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toHaveClass(
      'glass',
      'border-line',
      'shadow-lg',
    )
    // `>` switches to commands. The query matches exactly one theme, so Enter is deterministic.
    await user.type(input, '>github dark{Enter}')
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('github-dark'),
    )
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('daedalus:theme')).toBe('github-dark')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), '>github light{Enter}')
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('github-light'),
    )
    expect(document.documentElement).toHaveClass('light')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
