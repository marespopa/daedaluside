import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyTheme, loadTheme } from './theme'
import {
  DEFAULT_THEME_SETTING,
  parseThemeSetting,
  resolveTheme,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeId,
  type ThemeSetting,
} from './themes'

function setSystemDark(dark: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches: dark,
    addEventListener() {},
    removeEventListener() {},
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.documentElement.className = ''
})

describe('theme registry', () => {
  it('has unique ids and offers both a light and a dark theme', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
    expect(THEMES.some((t) => t.kind === 'light')).toBe(true)
    expect(THEMES.some((t) => t.kind === 'dark')).toBe(true)
  })

  it('matches the ids and kinds in public/theme-init.js', () => {
    const src = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8')
    const ids = (name: string) =>
      [...src.matchAll(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\]`, 'g'))].flatMap(
        (m) => [...m[1]!.matchAll(/'([\w-]+)'/g)].map((x) => x[1]!),
      )
    expect(ids('IDS').sort()).toEqual(THEMES.map((t) => t.id).sort())
    expect(ids('DARK').sort()).toEqual(
      THEMES.filter((t) => t.kind === 'dark')
        .map((t) => t.id)
        .sort(),
    )
  })
})

const setting = (
  mode: ThemeSetting['mode'],
  light: ThemeId = 'paper',
  dark: ThemeId = 'deep-slate',
) => ({ mode, light, dark }) as const

describe('setting handling', () => {
  it('maps old single-value preferences to a setting', () => {
    expect(parseThemeSetting('light')).toEqual(setting('light'))
    expect(parseThemeSetting('dark')).toEqual(setting('dark'))
    expect(parseThemeSetting('dracula')).toEqual(setting('dark', 'paper', 'dracula'))
    expect(parseThemeSetting('one-light')).toEqual(setting('light', 'one-light'))
    expect(parseThemeSetting('system')).toEqual(setting('system'))
  })

  it('falls back to defaults for unreadable or mismatched values', () => {
    expect(parseThemeSetting(null)).toEqual(DEFAULT_THEME_SETTING)
    expect(parseThemeSetting('nope')).toEqual(DEFAULT_THEME_SETTING)
    expect(parseThemeSetting('{"mode":"x","light":"dracula","dark":"paper"}')).toEqual(
      DEFAULT_THEME_SETTING,
    )
  })

  it('resolves system from the OS setting, using the chosen theme per side', () => {
    const s = setting('system', 'one-light', 'dracula')
    expect(resolveTheme(s, true)).toBe('dracula')
    expect(resolveTheme(s, false)).toBe('one-light')
    expect(resolveTheme({ ...s, mode: 'dark' }, false)).toBe('dracula')
  })
})

describe('applying and remembering the theme', () => {
  it('sets data-theme and the light/dark class, and saves the setting', () => {
    const s = setting('dark', 'paper', 'github-dark')
    applyTheme(s)
    const root = document.documentElement
    expect(root.dataset.theme).toBe('github-dark')
    expect(root).toHaveClass('dark')
    expect(root).not.toHaveClass('light')
    expect(loadTheme()).toEqual(s)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(JSON.stringify(s))
  })

  it('migrates a legacy "dark" value on load', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(loadTheme()).toEqual(setting('dark'))
  })

  it('system follows the OS setting', () => {
    const s = setting('system', 'one-light', 'dracula')
    setSystemDark(true)
    applyTheme(s)
    expect(document.documentElement.dataset.theme).toBe('dracula')
    setSystemDark(false)
    applyTheme(s)
    expect(document.documentElement.dataset.theme).toBe('one-light')
  })
})

describe('public/theme-init.js (runs before first paint)', () => {
  const src = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8')
  const run = () => new Function(src)()
  const save = (v: unknown) =>
    localStorage.setItem(THEME_STORAGE_KEY, typeof v === 'string' ? v : JSON.stringify(v))

  it('applies the saved setting without waiting for the app', () => {
    save(setting('dark', 'paper', 'dracula'))
    run()
    expect(document.documentElement.dataset.theme).toBe('dracula')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('in system mode picks the chosen theme for the OS side', () => {
    save(setting('system', 'one-light', 'dracula'))
    setSystemDark(false)
    run()
    expect(document.documentElement.dataset.theme).toBe('one-light')
  })

  it('falls back to the system setting for unknown values', () => {
    setSystemDark(true)
    save('garbage')
    run()
    expect(document.documentElement.dataset.theme).toBe('deep-slate')
  })

  it('maps legacy values', () => {
    save('light')
    run()
    expect(document.documentElement.dataset.theme).toBe('paper')
    expect(document.documentElement).toHaveClass('light')
    document.documentElement.className = ''
    save('dracula')
    run()
    expect(document.documentElement.dataset.theme).toBe('dracula')
  })
})
