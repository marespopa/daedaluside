import { describe, expect, it } from 'vitest'
import { formatEta, remainingMs } from './loadEstimate'

describe('load estimate', () => {
  it('stays silent without a total, progress, or a second of data', () => {
    expect(remainingMs(10, null, 5000)).toBeNull()
    expect(remainingMs(0, 100, 5000)).toBeNull()
    expect(remainingMs(10, 100, 500)).toBeNull()
    expect(remainingMs(100, 100, 5000)).toBeNull()
  })

  it('extrapolates the average rate', () => {
    expect(remainingMs(25, 100, 2000)).toBe(6000)
  })

  it('formats coarsely', () => {
    expect(formatEta(2000)).toBe('a few seconds left')
    expect(formatEta(8000)).toBe('about 10s left')
    expect(formatEta(95_000)).toBe('about 1m 40s left')
  })
})
