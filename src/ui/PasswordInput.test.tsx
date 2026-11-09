import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordInput } from './PasswordInput'

describe('PasswordInput', () => {
  it('hides the text until Show is pressed', async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label="Passphrase" defaultValue="" />)
    const field = screen.getByLabelText('Passphrase')
    // Masked with CSS, not type=password, so password managers do not attach.
    expect(field).toHaveAttribute('type', 'text')
    expect(field).toHaveClass('[-webkit-text-security:disc]')
    await user.type(field, 'abc')
    expect(field).toHaveValue('abc')
    await user.click(screen.getByRole('button', { name: 'Show Passphrase' }))
    expect(field).not.toHaveClass('[-webkit-text-security:disc]')
    expect(screen.getByRole('button', { name: 'Hide Passphrase' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('turns off autocorrect and capitalisation for the soft keyboard', () => {
    render(<PasswordInput aria-label="Passphrase" />)
    const field = screen.getByLabelText('Passphrase')
    expect(field).toHaveAttribute('autocapitalize', 'none')
    expect(field).toHaveAttribute('autocorrect', 'off')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveAttribute('data-1p-ignore')
    expect(field).toHaveAttribute('data-lpignore', 'true')
  })
})
