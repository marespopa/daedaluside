import { atom } from 'jotai'
import {
  normalizePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeKind,
  type ThemePreference,
} from './themes'

export type { ThemePreference } from './themes'

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const systemPrefersDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export function loadTheme(): ThemePreference {
  try {
    return normalizePreference(storage()?.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

/** Sets the theme on <html> and saves the preference, so a reload keeps it. */
export function applyTheme(pref: ThemePreference, root = document.documentElement) {
  const id = resolveTheme(pref, systemPrefersDark())
  root.dataset.theme = id
  const dark = themeKind(id) === 'dark'
  root.classList.toggle('dark', dark)
  root.classList.toggle('light', !dark)
  try {
    storage()?.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    /* storage unavailable: the theme still applies for this session */
  }
}

/** When the preference is `system`, follow the OS setting as it changes. */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => undefined
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (loadTheme() === 'system') applyTheme('system')
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

const base = atom<ThemePreference>(loadTheme())
export const themeAtom = atom(
  (get) => get(base),
  (_get, set, next: ThemePreference) => {
    applyTheme(next)
    set(base, next)
  },
)
