import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_FONTS,
  DEFAULT_TYPOGRAPHY,
  TYPOGRAPHY_STORAGE_KEY,
  UI_FONTS,
  parseTypography,
} from './fonts'
import { applyTypography } from './typography'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

describe('parseTypography', () => {
  it('returns defaults for missing or broken values', () => {
    expect(parseTypography(null)).toEqual(DEFAULT_TYPOGRAPHY)
    expect(parseTypography('{nope')).toEqual(DEFAULT_TYPOGRAPHY)
    expect(parseTypography('{"uiFont":"comic","codeFont":1}')).toEqual(DEFAULT_TYPOGRAPHY)
  })

  it('clamps size and line height into the allowed range', () => {
    expect(parseTypography('{"fontSize":99,"lineHeight":0.5}')).toMatchObject({
      fontSize: 24,
      lineHeight: 1.3,
    })
    expect(parseTypography('{"fontSize":3,"lineHeight":9}')).toMatchObject({
      fontSize: 12,
      lineHeight: 1.8,
    })
  })

  it('has the roster the product asks for', () => {
    expect(UI_FONTS.map((f) => f.id)).toEqual([
      'space-grotesk',
      'instrument-sans',
      'plus-jakarta-sans',
      'satoshi',
      'system',
    ])
    expect(CODE_FONTS).toHaveLength(8)
  })
})

describe('applyTypography', () => {
  it('sets the variables and persists the setting', () => {
    const root = document.documentElement
    const setting = {
      uiFont: 'system',
      codeFont: 'fira-code',
      fontSize: 18,
      lineHeight: 1.7,
      ligatures: false,
    }
    applyTypography(setting)
    expect(root.style.getPropertyValue('--editor-font-size')).toBe('18px')
    expect(root.style.getPropertyValue('--editor-line-height')).toBe('1.7')
    expect(root.style.getPropertyValue('--editor-ligatures')).toBe('none')
    expect(root.style.getPropertyValue('--font-code')).toContain('Fira Code')
    expect(parseTypography(localStorage.getItem(TYPOGRAPHY_STORAGE_KEY))).toEqual(setting)
  })

  it('loads only the selected fonts, on demand', () => {
    const ui = UI_FONTS.find((f) => f.id === 'instrument-sans')!
    const first = UI_FONTS[0]!
    const realUi = ui.load
    const realFirst = first.load
    const loadUi = vi.fn(() => Promise.resolve())
    const loadFirst = vi.fn(() => Promise.resolve())
    ui.load = loadUi
    first.load = loadFirst
    try {
      applyTypography({ ...DEFAULT_TYPOGRAPHY, uiFont: 'instrument-sans' })
      expect(loadUi).toHaveBeenCalledTimes(1)
      expect(loadFirst).not.toHaveBeenCalled()
    } finally {
      ui.load = realUi
      first.load = realFirst
    }
  })
})
