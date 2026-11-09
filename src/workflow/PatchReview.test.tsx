import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PatchReview from './PatchReview'
import type { FilePatch } from './types'

const lines = (...l: string[]) => l.join('\n') + '\n'
const patches: FilePatch[] = [
  {
    path: 'x.ts',
    base: lines('a', 'b', 'c', 'd', 'e', 'f', 'g'),
    content: lines('A', 'b', 'c', 'd', 'e', 'f', 'G'),
  },
  { path: 'n.ts', base: null, content: 'hi\n' },
]

describe('PatchReview', () => {
  it('starts with everything accepted and applies it all', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn(async () => {})
    render(<PatchReview patches={patches} onApply={onApply} onCancel={() => {}} />)
    expect(screen.getByText(/3 of 3 hunks selected/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply selected' }))
    expect(onApply).toHaveBeenCalledWith(patches)
  })

  it('applies only the hunks left checked', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn(async () => {})
    render(<PatchReview patches={patches} onApply={onApply} onCancel={() => {}} />)
    await user.click(screen.getByRole('checkbox', { name: /Hunk 2 of x\.ts/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Select all changes in n.ts' }))
    expect(screen.getByText(/1 of 3 hunks selected/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply selected' }))
    expect(onApply).toHaveBeenCalledWith([
      { ...patches[0], content: lines('A', 'b', 'c', 'd', 'e', 'f', 'g') },
    ])
  })

  it('disables Apply with nothing selected', async () => {
    const user = userEvent.setup()
    render(<PatchReview patches={patches} onApply={vi.fn()} onCancel={() => {}} />)
    await user.click(screen.getByRole('checkbox', { name: 'Select all changes in x.ts' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select all changes in n.ts' }))
    expect(screen.getByRole('button', { name: 'Apply selected' })).toBeDisabled()
  })

  it('shows a busy state at once and locks the controls while applying', async () => {
    const user = userEvent.setup()
    let done = () => {}
    const onApply = vi.fn(() => new Promise<void>((r) => (done = r)))
    render(<PatchReview patches={patches} onApply={onApply} onCancel={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Apply selected' }))
    expect(screen.getByRole('button', { name: 'Applying…' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Hunk 1 of x\.ts/ })).toBeDisabled()
    done()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply selected' })).toBeEnabled(),
    )
  })

  it('cancels with the button and with Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<PatchReview patches={patches} onApply={vi.fn()} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('checkbox', { name: /Hunk 1 of x\.ts/ }))
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('marks added and removed lines with symbols, not color alone', () => {
    render(<PatchReview patches={patches} onApply={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByText(/^- a$/)).toBeInTheDocument()
    expect(screen.getByText(/^\+ A$/)).toBeInTheDocument()
  })
})
