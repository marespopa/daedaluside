import { render, screen } from '@testing-library/react'
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
    await user.type(input, 'dark{Enter}')
    expect(document.documentElement).toHaveClass('dark')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'light{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
