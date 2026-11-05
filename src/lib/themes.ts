/**
 * The theme registry. Ids match the `[data-theme]` blocks in src/styles/tokens.css
 * and the list in public/theme-init.js; tests in src/lib/themes.test.ts check both.
 * Four light and four dark, ordered by the usual "most used" palettes.
 */
export const THEMES = [
  { id: 'paper', name: 'Paper', kind: 'light' },
  { id: 'github-light', name: 'GitHub Light', kind: 'light' },
  { id: 'solarized-light', name: 'Solarized Light', kind: 'light' },
  { id: 'one-light', name: 'One Light', kind: 'light' },
  { id: 'deep-slate', name: 'Deep Slate', kind: 'dark' },
  { id: 'github-dark', name: 'GitHub Dark', kind: 'dark' },
  { id: 'one-dark', name: 'One Dark', kind: 'dark' },
  { id: 'dracula', name: 'Dracula', kind: 'dark' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']
export type ThemeKind = 'light' | 'dark'
/** `system` follows the OS light/dark setting; `light` and `dark` pin it. */
export type ThemeMode = 'system' | ThemeKind

/** The mode plus which theme to use on each side, so `system` can still pick both. */
export interface ThemeSetting {
  mode: ThemeMode
  light: ThemeId
  dark: ThemeId
}

export const DEFAULT_THEME_SETTING: ThemeSetting = {
  mode: 'system',
  light: 'paper',
  dark: 'deep-slate',
}

export const THEME_STORAGE_KEY = 'daedalus:theme'

export function themeKind(id: ThemeId): ThemeKind {
  return THEMES.find((t) => t.id === id)!.kind
}

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v)
}

/**
 * Turns a stored value into a setting. Anything unreadable becomes the default.
 * Older versions stored one bare string (a theme id, `system`, `light` or `dark`);
 * those migrate to the equivalent setting.
 */
export function parseThemeSetting(raw: string | null | undefined): ThemeSetting {
  const d = DEFAULT_THEME_SETTING
  if (!raw) return d
  if (raw === 'light' || raw === 'dark') return { ...d, mode: raw }
  if (isThemeId(raw)) return { ...d, mode: themeKind(raw), [themeKind(raw)]: raw }
  try {
    const v = JSON.parse(raw) as Partial<ThemeSetting> | null
    const light =
      isThemeId(v?.light) && themeKind(v.light) === 'light' ? v.light : d.light
    const dark = isThemeId(v?.dark) && themeKind(v.dark) === 'dark' ? v.dark : d.dark
    const mode = v?.mode === 'light' || v?.mode === 'dark' ? v.mode : 'system'
    return { mode, light, dark }
  } catch {
    return d
  }
}

export function resolveTheme(s: ThemeSetting, prefersDark: boolean): ThemeId {
  const kind = s.mode === 'system' ? (prefersDark ? 'dark' : 'light') : s.mode
  return s[kind]
}
