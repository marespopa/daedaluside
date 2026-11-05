import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { Input } from './Input'

describe('Input', () => {
  it('labels the field and forwards the ref to the input element', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input aria-label="Search" ref={ref} />)
    expect(screen.getByRole('textbox', { name: 'Search' })).toBe(ref.current)
  })

  it('focuses the field when the frame is clicked', async () => {
    render(<Input aria-label="Search" variant="field" />)
    const frame = screen.getByRole('textbox', { name: 'Search' }).closest('label')!
    await userEvent.setup().click(frame)
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus()
  })

  it('stretches the frame with the className it is given', () => {
    render(<Input aria-label="Search" variant="bare" size="lg" className="w-full" />)
    const frame = screen.getByRole('textbox', { name: 'Search' }).closest('label')!
    expect(frame).toHaveClass('w-full', 'h-12')
  })
})
