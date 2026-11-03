import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { installMemoryOpfs } from './workspace/testing/opfsSetup'

beforeEach(() => {
  installMemoryOpfs()
})

// jsdom's KeyboardEvent does not give Enter a keyCode, but some editor deps check it.
const OriginalKeyboardEvent = window.KeyboardEvent
const PatchedKeyboardEvent = class extends OriginalKeyboardEvent {
  constructor(type: string, init: KeyboardEventInit = {}) {
    const patched: KeyboardEventInit = { ...init }
    if (patched.key === 'Enter' && patched.keyCode === undefined) patched.keyCode = 13
    super(type, patched)
  }
} as typeof KeyboardEvent
window.KeyboardEvent = PatchedKeyboardEvent
globalThis.KeyboardEvent = PatchedKeyboardEvent

// Some dependencies read keyCode. jsdom gives Enter keyCode 0, so fix it in the capture phase.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Enter' && e.keyCode === 0) {
      Object.defineProperty(e, 'keyCode', { value: 13 })
    }
  },
  true,
)

// Storage and the workspace open through real async work; on a loaded machine (the
// whole suite in parallel) the 1 s default is too tight for `waitFor` to be reliable.
configure({ asyncUtilTimeout: 5000 })

// jsdom has no layout; CodeMirror measures text ranges when focusing or scrolling.
const emptyRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
}
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () =>
  ({ ...emptyRect, toJSON: () => ({}) }) as DOMRect
