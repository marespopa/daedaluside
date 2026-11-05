import { atom } from 'jotai'
import {
  DEFAULT_THEME_SETTING,
  parseThemeSetting,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeKind,
  type ThemeSetting,
} from './themes'

export type { ThemeSetting } from './themes'

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const systemPrefersDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export function loadTheme(): ThemeSetting {
  try {
    return parseThemeSetting(storage()?.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME_SETTING
  }
}

/** Sets the theme on <html> and saves the setting, so a reload keeps it. */
export function applyTheme(setting: ThemeSetting, root = document.documentElement) {
  const id = resolveTheme(setting, systemPrefersDark())
  root.dataset.theme = id
  const dark = themeKind(id) === 'dark'
  root.classList.toggle('dark', dark)
  root.classList.toggle('light', !dark)
  try {
    storage()?.setItem(THEME_STORAGE_KEY, JSON.stringify(setting))
  } catch {
    /* storage unavailable: the theme still applies for this session */
  }
}

/** When the mode is `system`, follow the OS setting as it changes. */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => undefined
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    const setting = loadTheme()
    if (setting.mode === 'system') applyTheme(setting)
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

const base = atom<ThemeSetting>(loadTheme())
export const themeAtom = atom(
  (get) => get(base),
  (_get, set, next: ThemeSetting) => {
    applyTheme(next)
    set(base, next)
  },
)
