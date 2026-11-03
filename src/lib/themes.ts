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
/** What the user picked. `system` follows the OS light/dark setting. */
export type ThemePreference = ThemeId | 'system'

/** Used when `system` resolves to light or dark. */
export const SYSTEM_LIGHT: ThemeId = 'paper'
export const SYSTEM_DARK: ThemeId = 'deep-slate'

export const THEME_STORAGE_KEY = 'daedalus:theme'

export function themeKind(id: ThemeId): 'light' | 'dark' {
  return THEMES.find((t) => t.id === id)!.kind
}

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v)
}

/**
 * Turns a stored value into a preference. Unknown values become `system`. The old
 * two-theme values migrate to their new equivalents.
 */
export function normalizePreference(v: string | null | undefined): ThemePreference {
  if (v === 'light') return SYSTEM_LIGHT
  if (v === 'dark') return SYSTEM_DARK
  if (v === 'system' || isThemeId(v)) return v
  return 'system'
}

export function resolveTheme(pref: ThemePreference, prefersDark: boolean): ThemeId {
  if (pref !== 'system') return pref
  return prefersDark ? SYSTEM_DARK : SYSTEM_LIGHT
}
