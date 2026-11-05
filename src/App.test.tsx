import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getDefaultStore } from 'jotai'
import App from './App'
import { runEx } from './editor/testing/runEx'
import { editorHandleAtom } from './state/editorAtoms'

describe('App', () => {
  it('opens the file tree with :Explore and closes it when the editor is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    const tree = screen.getByLabelText('File tree')
    expect(tree).toHaveAttribute('aria-hidden', 'true')

    const view = getDefaultStore().get(editorHandleAtom)!.view
    act(() => runEx(view, 'Explore'))
    expect(tree).toHaveAttribute('aria-hidden', 'false')

    await user.click(screen.getByRole('main'))
    expect(tree).toHaveAttribute('aria-hidden', 'true')
  })

  it('toggles the file tree with Mod-B', async () => {
    const user = userEvent.setup()
    render(<App />)
    const tree = screen.getByLabelText('File tree')

    await user.keyboard('{Control>}b{/Control}')
    expect(tree).toHaveAttribute('aria-hidden', 'false')
    await user.keyboard('{Control>}b{/Control}')
    expect(tree).toHaveAttribute('aria-hidden', 'true')
  })

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
    expect(JSON.parse(localStorage.getItem('daedalus:theme')!)).toMatchObject({
      mode: 'dark',
      dark: 'github-dark',
    })
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
