import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, IconButton } from '.'

describe('Button', () => {
  it('is a button of type "button" by default, so it never submits a form', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('renders a leading icon as decorative (aria-hidden) next to its text', () => {
    const { container } = render(<Button icon="file-plus">New file</Button>)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'New file' })).toContainElement(svg)
  })

  it('respects disabled and does not fire onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Create
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('IconButton', () => {
  it('uses label as its accessible name and tooltip', () => {
    render(<IconButton label="Dismiss" icon="x" />)
    const btn = screen.getByRole('button', { name: 'Dismiss' })
    expect(btn).toHaveAttribute('title', 'Dismiss')
    expect(btn.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('calls onClick when pressed', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<IconButton label="Delete a.txt" icon="trash" onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: 'Delete a.txt' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
