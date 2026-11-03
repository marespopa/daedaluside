import { atom } from 'jotai'

export type ThemePreference = 'system' | 'light' | 'dark'
const KEY = 'daedalus:theme'

export function loadTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (pref !== 'system') root.classList.add(pref)
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* storage unavailable */
  }
}

const base = atom<ThemePreference>(loadTheme())
export const themeAtom = atom(
  (get) => get(base),
  (_get, set, next: ThemePreference) => {
    applyTheme(next)
    set(base, next)
  },
)
