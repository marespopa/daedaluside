/** Two quick taps of Shift, with no other key pressed in between. */
export const DOUBLE_SHIFT_MS = 400

/**
 * Returns the handlers to wire to window `keydown` and `keyup`. A tap is a Shift press
 * and release with no other key in between, so capitals and Shift chords (Shift+A) never
 * count. Two taps within `windowMs` call `onDouble`. `now` is injectable for tests.
 */
export function createDoubleShift(
  onDouble: () => void,
  { windowMs = DOUBLE_SHIFT_MS, now = () => performance.now() } = {},
) {
  let shiftDown = false
  let clean = false
  let lastTap = -Infinity

  return {
    keydown(e: KeyboardEvent) {
      if (e.key === 'Shift') {
        if (!e.repeat) {
          shiftDown = true
          clean = true
        }
        return
      }
      // Any other key makes the current press part of a chord, and breaks a pending tap.
      clean = false
      lastTap = -Infinity
    },
    keyup(e: KeyboardEvent) {
      if (e.key !== 'Shift') return
      const tap = shiftDown && clean
      shiftDown = false
      clean = false
      if (!tap) return
      const t = now()
      if (t - lastTap <= windowMs) {
        lastTap = -Infinity
        onDouble()
      } else {
        lastTap = t
      }
    },
  }
}
