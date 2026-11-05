export const TYPOGRAPHY_STORAGE_KEY = 'daedalus:typography'

export interface FontDef {
  id: string
  label: string
  /** CSS font-family value, with fallbacks so text never disappears while loading. */
  stack: string
  /** Fetches the font files. Absent for fonts that need no download. */
  load?: (() => Promise<unknown>) | undefined
}

const SANS_FALLBACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const MONO_FALLBACK =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"

const loadedFiles = new Map<string, Promise<void>>()

/** Registers a self-hosted font once, then resolves when its files are ready. */
function selfHosted(family: string, files: [weight: string, url: string][]) {
  return () => {
    let p = loadedFiles.get(family)
    if (!p) {
      p = Promise.all(
        files.map(async ([weight, url]) => {
          const face = new FontFace(family, `url(${url}) format('woff2')`, {
            weight,
            display: 'swap',
          })
          document.fonts.add(await face.load())
        }),
      ).then(() => undefined)
      p.catch(() => loadedFiles.delete(family))
      loadedFiles.set(family, p)
    }
    return p
  }
}

export const UI_FONTS: FontDef[] = [
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    stack: `'Space Grotesk', ${SANS_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/space-grotesk/latin-400.css'),
        import('@fontsource/space-grotesk/latin-500.css'),
      ]),
  },
  {
    id: 'instrument-sans',
    label: 'Instrument Sans',
    stack: `'Instrument Sans', ${SANS_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/instrument-sans/latin-400.css'),
        import('@fontsource/instrument-sans/latin-500.css'),
      ]),
  },
  {
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    stack: `'Plus Jakarta Sans', ${SANS_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/plus-jakarta-sans/latin-400.css'),
        import('@fontsource/plus-jakarta-sans/latin-500.css'),
      ]),
  },
  {
    id: 'satoshi',
    label: 'Satoshi',
    stack: `'Satoshi', ${SANS_FALLBACK}`,
    load: selfHosted('Satoshi', [
      ['400', '/fonts/satoshi/Satoshi-Regular.woff2'],
      ['500', '/fonts/satoshi/Satoshi-Medium.woff2'],
    ]),
  },
  { id: 'system', label: 'System Native', stack: SANS_FALLBACK },
]

export const CODE_FONTS: FontDef[] = [
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: `'JetBrains Mono', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/jetbrains-mono/latin-400.css'),
        import('@fontsource/jetbrains-mono/latin-500.css'),
      ]),
  },
  {
    id: 'geist-mono',
    label: 'Geist Mono',
    stack: `'Geist Mono', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/geist-mono/latin-400.css'),
        import('@fontsource/geist-mono/latin-500.css'),
      ]),
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    stack: `'IBM Plex Mono', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/ibm-plex-mono/latin-400.css'),
        import('@fontsource/ibm-plex-mono/latin-500.css'),
      ]),
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    stack: `'Cascadia Code', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/cascadia-code/latin-400.css'),
        import('@fontsource/cascadia-code/latin-500.css'),
      ]),
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    stack: `'Fira Code', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/fira-code/latin-400.css'),
        import('@fontsource/fira-code/latin-500.css'),
      ]),
  },
  {
    id: 'iosevka',
    label: 'Iosevka',
    stack: `'Iosevka', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/iosevka/latin-400.css'),
        import('@fontsource/iosevka/latin-500.css'),
      ]),
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    stack: `'Source Code Pro', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/source-code-pro/latin-400.css'),
        import('@fontsource/source-code-pro/latin-500.css'),
      ]),
  },
  {
    id: 'inconsolata',
    label: 'Inconsolata',
    stack: `'Inconsolata', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([
        import('@fontsource/inconsolata/latin-400.css'),
        import('@fontsource/inconsolata/latin-500.css'),
      ]),
  },
]

export const FONT_SIZE_RANGE = { min: 12, max: 24, step: 1 } as const
export const LINE_HEIGHT_RANGE = { min: 1.3, max: 1.8, step: 0.1 } as const

export interface TypographySetting {
  uiFont: string
  codeFont: string
  fontSize: number
  lineHeight: number
  ligatures: boolean
}

export const DEFAULT_TYPOGRAPHY: TypographySetting = {
  uiFont: 'space-grotesk',
  codeFont: 'jetbrains-mono',
  fontSize: 14,
  lineHeight: 1.5,
  ligatures: true,
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function clampFontSize(n: number): number {
  return Number.isFinite(n)
    ? clamp(Math.round(n), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
    : DEFAULT_TYPOGRAPHY.fontSize
}

export function clampLineHeight(n: number): number {
  return Number.isFinite(n)
    ? Math.round(clamp(n, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max) * 10) / 10
    : DEFAULT_TYPOGRAPHY.lineHeight
}

export const findUiFont = (id: string) =>
  UI_FONTS.find((f) => f.id === id) ?? UI_FONTS[0]!
export const findCodeFont = (id: string) =>
  CODE_FONTS.find((f) => f.id === id) ?? CODE_FONTS[0]!

/** Reads a stored value, falling back to the defaults for anything unusable. */
export function parseTypography(raw: string | null | undefined): TypographySetting {
  if (!raw) return DEFAULT_TYPOGRAPHY
  try {
    const v = (JSON.parse(raw) ?? {}) as Record<string, unknown>
    return {
      uiFont: UI_FONTS.some((f) => f.id === v.uiFont)
        ? (v.uiFont as string)
        : DEFAULT_TYPOGRAPHY.uiFont,
      codeFont: CODE_FONTS.some((f) => f.id === v.codeFont)
        ? (v.codeFont as string)
        : DEFAULT_TYPOGRAPHY.codeFont,
      fontSize:
        typeof v.fontSize === 'number'
          ? clampFontSize(v.fontSize)
          : DEFAULT_TYPOGRAPHY.fontSize,
      lineHeight:
        typeof v.lineHeight === 'number'
          ? clampLineHeight(v.lineHeight)
          : DEFAULT_TYPOGRAPHY.lineHeight,
      ligatures:
        typeof v.ligatures === 'boolean' ? v.ligatures : DEFAULT_TYPOGRAPHY.ligatures,
    }
  } catch {
    return DEFAULT_TYPOGRAPHY
  }
}
