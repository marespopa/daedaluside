import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyTheme, loadTheme } from './theme'
import { normalizePreference, resolveTheme, THEME_STORAGE_KEY, THEMES } from './themes'

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

describe('preference handling', () => {
  it('maps old two-theme values to their new equivalents', () => {
    expect(normalizePreference('light')).toBe('paper')
    expect(normalizePreference('dark')).toBe('deep-slate')
  })

  it('keeps known ids and treats anything else as system', () => {
    expect(normalizePreference('dracula')).toBe('dracula')
    expect(normalizePreference('system')).toBe('system')
    expect(normalizePreference('nope')).toBe('system')
    expect(normalizePreference(null)).toBe('system')
  })

  it('resolves system from the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('deep-slate')
    expect(resolveTheme('system', false)).toBe('paper')
    expect(resolveTheme('one-dark', false)).toBe('one-dark')
  })
})

describe('applying and remembering the theme', () => {
  it('sets data-theme and the light/dark class, and saves the choice', () => {
    applyTheme('github-dark')
    const root = document.documentElement
    expect(root.dataset.theme).toBe('github-dark')
    expect(root).toHaveClass('dark')
    expect(root).not.toHaveClass('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('github-dark')
  })

  it('a reload restores the saved theme', () => {
    applyTheme('solarized-light')
    expect(loadTheme()).toBe('solarized-light')
  })

  it('migrates a legacy "dark" preference on load', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(loadTheme()).toBe('deep-slate')
  })

  it('system follows the OS setting', () => {
    setSystemDark(true)
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('deep-slate')
    setSystemDark(false)
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('paper')
  })
})

describe('public/theme-init.js (runs before first paint)', () => {
  const src = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8')
  const run = () => new Function(src)()

  it('applies the saved theme without waiting for the app', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dracula')
    run()
    expect(document.documentElement.dataset.theme).toBe('dracula')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('falls back to the system setting for unknown values', () => {
    setSystemDark(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'garbage')
    run()
    expect(document.documentElement.dataset.theme).toBe('deep-slate')
  })

  it('maps legacy values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    run()
    expect(document.documentElement.dataset.theme).toBe('paper')
    expect(document.documentElement).toHaveClass('light')
  })
})
