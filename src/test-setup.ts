import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import 'fake-indexeddb/auto'

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
