import { createDoubleShift } from './doubleShift'

function setup(times: number[] = []) {
  let t = 0
  const onDouble = vi.fn()
  const d = createDoubleShift(onDouble, { now: () => t })
  const key = (type: 'keydown' | 'keyup', k: string, repeat = false) =>
    d[type](new KeyboardEvent(type, { key: k, repeat }))
  const tap = (at: number) => {
    t = at
    key('keydown', 'Shift')
    key('keyup', 'Shift')
  }
  return { onDouble, key, tap, times }
}

describe('double Shift', () => {
  it('fires on two quick taps', () => {
    const s = setup()
    s.tap(0)
    expect(s.onDouble).not.toHaveBeenCalled()
    s.tap(200)
    expect(s.onDouble).toHaveBeenCalledTimes(1)
  })

  it('ignores taps further apart than the window', () => {
    const s = setup()
    s.tap(0)
    s.tap(500)
    expect(s.onDouble).not.toHaveBeenCalled()
  })

  it('does not count capitals or Shift chords', () => {
    const s = setup()
    s.key('keydown', 'Shift')
    s.key('keydown', 'A') // a letter typed while Shift is held
    s.key('keyup', 'A')
    s.key('keyup', 'Shift')
    s.tap(100)
    expect(s.onDouble).not.toHaveBeenCalled()
  })

  it('a key between two taps breaks the sequence', () => {
    const s = setup()
    s.tap(0)
    s.key('keydown', 'a')
    s.tap(100)
    expect(s.onDouble).not.toHaveBeenCalled()
  })

  it('a held key repeating does not count as extra taps', () => {
    const s = setup()
    s.key('keydown', 'Shift')
    s.key('keydown', 'Shift', true)
    s.key('keyup', 'Shift')
    expect(s.onDouble).not.toHaveBeenCalled()
  })

  it('resets after firing, so a third tap starts over', () => {
    const s = setup()
    s.tap(0)
    s.tap(100)
    s.tap(200)
    expect(s.onDouble).toHaveBeenCalledTimes(1)
    s.tap(300)
    expect(s.onDouble).toHaveBeenCalledTimes(2)
  })
})
