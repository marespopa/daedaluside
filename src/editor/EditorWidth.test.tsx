import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { createStore, Provider } from 'jotai'
import App from '../App'
import { EDITOR_WIDTH_KEY } from '../state/editorAtoms'

describe('full width toggle', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
  })

  function mount() {
    const store = createStore()
    render(
      <Provider store={store}>
        <App />
      </Provider>,
    )
    return store
  }

  // The editor pane wraps the host div that carries the width attribute.
  const pane = () => screen.getByTestId('editor').parentElement!

  it('toggles from the header button and remembers the choice', async () => {
    const user = userEvent.setup()
    mount()
    const button = await screen.findByRole('button', { name: 'Full width' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(pane()).toHaveAttribute('data-editor-width', 'measured')

    await user.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(pane()).toHaveAttribute('data-editor-width', 'full')
    expect(localStorage.getItem(EDITOR_WIDTH_KEY)).toBe('full')

    await user.click(button)
    expect(pane()).toHaveAttribute('data-editor-width', 'measured')
    expect(localStorage.getItem(EDITOR_WIDTH_KEY)).toBe('measured')
  })

  it('is also a command in the palette', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('button', { name: 'Full width' })
    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
    await user.click(screen.getByRole('option', { name: 'View: Toggle Full Width' }))
    expect(pane()).toHaveAttribute('data-editor-width', 'full')
  })
})
