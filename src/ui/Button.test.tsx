import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { Button, IconButton } from '.'

describe('Button', () => {
  it('is a button of type "button" by default, so it never submits a form', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('accepts type="submit" for forms', () => {
    render(<Button type="submit">Create</Button>)
    expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute(
      'type',
      'submit',
    )
  })

  it('renders a leading icon as decorative (aria-hidden) next to its text', () => {
    const { container } = render(<Button icon="file-plus">New file</Button>)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'New file' })).toContainElement(svg)
  })

  it('uses the shared token classes for each variant', () => {
    const { rerender } = render(<Button variant="primary">Go</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-text', 'text-canvas')
    rerender(<Button variant="secondary">Go</Button>)
    expect(screen.getByRole('button')).toHaveClass('border-line', 'bg-canvas')
    rerender(<Button variant="ghost">Go</Button>)
    expect(screen.getByRole('button')).toHaveClass('text-muted')
    rerender(<Button variant="danger">Go</Button>)
    expect(screen.getByRole('button')).toHaveClass('text-diff-remove-fg')
  })

  it('forwards the ref to the underlying element', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Close</Button>)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Close' }))
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

  it('is square (no text padding) and keeps the ghost style by default', () => {
    render(<IconButton label="Menu" icon="menu" size="sm" />)
    const btn = screen.getByRole('button', { name: 'Menu' })
    expect(btn).toHaveClass('size-7', 'text-muted')
  })

  it('calls onClick when pressed', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<IconButton label="Delete a.txt" icon="trash" onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: 'Delete a.txt' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
