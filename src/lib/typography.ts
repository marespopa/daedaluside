import { atom } from 'jotai'
import {
  DEFAULT_TYPOGRAPHY,
  findCodeFont,
  findUiFont,
  parseTypography,
  TYPOGRAPHY_STORAGE_KEY,
  type TypographySetting,
} from './fonts'

export type { TypographySetting } from './fonts'

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function loadTypography(): TypographySetting {
  try {
    return parseTypography(storage()?.getItem(TYPOGRAPHY_STORAGE_KEY))
  } catch {
    return DEFAULT_TYPOGRAPHY
  }
}

/** Editors measure on window resize; nudge them once new glyph metrics are in. */
function remeasure() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'))
}

/**
 * Sets the typography variables on <html> (instant, using the fallback stack), then
 * downloads the chosen fonts on demand and re-measures the editor when they arrive.
 */
export function applyTypography(
  setting: TypographySetting,
  root = document.documentElement,
) {
  const ui = findUiFont(setting.uiFont)
  const code = findCodeFont(setting.codeFont)
  const s = root.style
  s.setProperty('--font-sans', ui.stack)
  s.setProperty('--font-mono', code.stack)
  s.setProperty('--font-code', code.stack)
  s.setProperty('--editor-font-size', `${setting.fontSize}px`)
  s.setProperty('--editor-line-height', String(setting.lineHeight))
  s.setProperty('--editor-ligatures', setting.ligatures ? 'normal' : 'none')
  try {
    storage()?.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(setting))
  } catch {
    /* storage unavailable: the setting still applies for this session */
  }
  const loads = [ui.load, code.load].filter((l) => l !== undefined)
  if (loads.length) {
    void Promise.all(loads.map((l) => l()))
      .then(() => document.fonts?.ready)
      .then(remeasure)
      .catch(() => undefined)
  }
  remeasure()
}

const base = atom<TypographySetting>(loadTypography())
export const typographyAtom = atom(
  (get) => get(base),
  (_get, set, next: TypographySetting) => {
    applyTypography(next)
    set(base, next)
  },
)
