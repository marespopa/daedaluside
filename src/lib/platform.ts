/** Label for the primary modifier key in shortcut hints. Apple platforms use ⌘, others Ctrl. */
const APPLE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

export const MOD_KEY_LABEL = APPLE ? '⌘' : 'Ctrl'

/** Label for the Alt / Option key in shortcut hints. */
export const ALT_KEY_LABEL = APPLE ? '⌥' : 'Alt'
