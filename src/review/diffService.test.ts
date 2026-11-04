import { DiffService } from './diffService'

describe('DiffService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces and delivers only the newest request', async () => {
    const svc = new DiffService(undefined, 150)
    const seen: number[] = []
    svc.schedule('a\n', 'a\nb\n', (r) => seen.push(r.stats.added))
    await vi.advanceTimersByTimeAsync(100)
    svc.schedule('a\n', 'a\nb\nc\n', (r) => seen.push(r.stats.added))
    await vi.advanceTimersByTimeAsync(149)
    expect(seen).toEqual([])
    await vi.advanceTimersByTimeAsync(5)
    expect(seen).toEqual([2])
    svc.dispose()
  })

  it('drops results after cancel', async () => {
    const svc = new DiffService(undefined, 10)
    const seen: unknown[] = []
    svc.schedule('', 'x\n', (r) => seen.push(r), true)
    svc.cancel()
    await vi.advanceTimersByTimeAsync(50)
    expect(seen).toEqual([])
    svc.dispose()
  })
})
