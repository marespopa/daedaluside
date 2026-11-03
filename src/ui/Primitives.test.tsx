import { render, screen } from '@testing-library/react'
import { Chip, GlassPopover, IconButton, Kbd, Panel } from '.'

describe('ui primitives', () => {
  it('render with semantic token classes', () => {
    render(
      <Panel data-testid="panel">
        <GlassPopover data-testid="glass">x</GlassPopover>
        <Chip>Plan Mode</Chip>
        <Kbd>⌘K</Kbd>
        <IconButton label="Toggle sidebar">+</IconButton>
      </Panel>,
    )
    expect(screen.getByTestId('panel')).toHaveClass('bg-surface', 'border-line')
    expect(screen.getByTestId('glass')).toHaveClass('glass')
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument()
    expect(screen.getByText('⌘K').tagName).toBe('KBD')
  })
})
