import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { describe, expect, it } from 'vitest'
import { themeAtom } from '../lib/theme'
import { typographyAtom } from '../lib/typography'
import { editorWidthAtom, vimEnabledAtom } from '../state/editorAtoms'
import { settingsOpenAtom } from '../state/workspaceAtoms'
import SettingsDialog from './SettingsDialog'

function setup() {
  const store = createStore()
  store.set(settingsOpenAtom, true)
  render(
    <Provider store={store}>
      <SettingsDialog />
    </Provider>,
  )
  return { store, user: userEvent.setup() }
}

describe('SettingsDialog', () => {
  it('picks light and dark themes independently of the mode', async () => {
    const { store, user } = setup()
    await user.click(screen.getByRole('combobox', { name: 'Dark theme' }))
    await user.click(screen.getByRole('option', { name: 'Dracula' }))
    await user.click(screen.getByRole('combobox', { name: 'Light theme' }))
    await user.click(screen.getByRole('option', { name: 'One Light' }))
    expect(store.get(themeAtom)).toEqual({
      mode: 'system',
      light: 'one-light',
      dark: 'dracula',
    })
  })

  it('switches mode and keeps the chosen themes', async () => {
    const { store, user } = setup()
    await user.click(screen.getByRole('combobox', { name: 'Dark theme' }))
    await user.click(screen.getByRole('option', { name: 'One Dark' }))
    await user.click(screen.getByRole('button', { name: 'Dark' }))
    expect(store.get(themeAtom)).toMatchObject({ mode: 'dark', dark: 'one-dark' })
    await user.click(screen.getByRole('button', { name: 'System' }))
    expect(store.get(themeAtom)).toMatchObject({ mode: 'system', dark: 'one-dark' })
  })

  it('toggles full width and vim', async () => {
    const { store, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Full-width editor' }))
    expect(store.get(editorWidthAtom)).toBe('full')
    await user.click(screen.getByRole('button', { name: 'Vim mode' }))
    expect(store.get(vimEnabledAtom)).toBe(false)
  })

  it('drives the theme list from the keyboard; Escape closes only the list', async () => {
    const { store, user } = setup()
    const box = screen.getByRole('combobox', { name: 'Dark theme' })
    box.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    expect(store.get(themeAtom).dark).toBe('one-dark')
    await user.keyboard('{ArrowDown}{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(store.get(settingsOpenAtom)).toBe(true)
  })

  it('closes with the Close button', async () => {
    const { store, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(store.get(settingsOpenAtom)).toBe(false)
  })

  it('changes fonts, size, line height and ligatures', async () => {
    const { store, user } = setup()
    await user.click(screen.getByRole('combobox', { name: 'Editor font' }))
    await user.click(screen.getByRole('option', { name: 'Iosevka' }))
    await user.click(screen.getByRole('combobox', { name: 'Interface font' }))
    await user.click(screen.getByRole('option', { name: 'System Native' }))
    await user.click(screen.getByRole('button', { name: 'Ligatures' }))
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Line height'), { target: { value: '1.7' } })
    expect(store.get(typographyAtom)).toEqual({
      uiFont: 'system',
      codeFont: 'iosevka',
      fontSize: 20,
      lineHeight: 1.7,
      ligatures: false,
    })
  })

  it('points AI setup at the AI Companion tab', async () => {
    const { user } = setup()
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByText(/AI Companion tab/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'AI' }))
    expect(await screen.findByText(/AI Companion tab/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Dark theme' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'General' }))
    expect(screen.getByRole('combobox', { name: 'Dark theme' })).toBeInTheDocument()
  })

  it('moves between tabs with the arrow keys', async () => {
    const { user } = setup()
    screen.getByRole('tab', { name: 'General' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'AI' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'AI' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus()
  })
})
