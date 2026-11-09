import { useAtom, useStore } from 'jotai'
import { useEffect, useRef } from 'react'
import { THEMES, type ThemeId, type ThemeMode } from '../lib/themes'
import { themeAtom } from '../lib/theme'
import {
  CODE_FONTS,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  UI_FONTS,
  clampFontSize,
  clampLineHeight,
} from '../lib/fonts'
import { typographyAtom } from '../lib/typography'
import { editorWidthAtom, vimEnabledAtom } from '../state/editorAtoms'
import { settingsOpenAtom } from '../state/workspaceAtoms'
import { Button, Select } from '../ui'
import AiSettings from '../ai/AiSettings'
import { focusEditor } from './useWorkspace'

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

export default function SettingsDialog() {
  const [open, setOpen] = useAtom(settingsOpenAtom)
  return open ? <Dialog onClose={() => setOpen(false)} /> : null
}

function Dialog({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const [vim, setVim] = useAtom(vimEnabledAtom)
  const [theme, setTheme] = useAtom(themeAtom)
  const [width, setWidth] = useAtom(editorWidthAtom)
  const [ty, setTy] = useAtom(typographyAtom)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeBtn.current?.focus()
    return () => {
      focusEditor(store)
    }
  }, [store])

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-canvas/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="glass anim-pop w-full max-w-md rounded-xl border border-line p-5 font-sans text-sm shadow-lg"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium">Settings</h2>
          <Button ref={closeBtn} variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <section aria-labelledby="appearance-h" className="space-y-2">
          <h3 id="appearance-h" className="text-xs tracking-wide text-muted uppercase">
            Appearance
          </h3>
          <div className="flex items-center justify-between gap-3">
            <p id="mode-l">Mode</p>
            <div role="group" aria-labelledby="mode-l" className="flex gap-1">
              {MODES.map((m) => (
                <Button
                  key={m.id}
                  variant={theme.mode === m.id ? 'primary' : 'secondary'}
                  size="sm"
                  icon={theme.mode === m.id ? 'check' : undefined}
                  aria-pressed={theme.mode === m.id}
                  onClick={() => setTheme({ ...theme, mode: m.id })}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>
          {(['light', 'dark'] as const).map((kind) => (
            <div key={kind} className="flex items-center justify-between gap-3">
              <label htmlFor={`theme-${kind}`}>
                {kind === 'light' ? 'Light theme' : 'Dark theme'}
              </label>
              <Select
                id={`theme-${kind}`}
                value={theme[kind]}
                options={THEMES.filter((t) => t.kind === kind).map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
                onChange={(v) => setTheme({ ...theme, [kind]: v as ThemeId })}
              />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <p>Full-width editor</p>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Full-width editor"
              aria-pressed={width === 'full'}
              onClick={() => setWidth(width === 'full' ? 'measured' : 'full')}
            >
              {width === 'full' ? 'On' : 'Off'}
            </Button>
          </div>
        </section>

        <section aria-labelledby="type-h" className="mt-5 space-y-2">
          <h3 id="type-h" className="text-xs tracking-wide text-muted uppercase">
            Typography
          </h3>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="ui-font">Interface font</label>
            <Select
              id="ui-font"
              value={ty.uiFont}
              options={UI_FONTS.map((f) => ({ value: f.id, label: f.label }))}
              onChange={(v) => setTy({ ...ty, uiFont: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="code-font">Editor font</label>
            <Select
              id="code-font"
              value={ty.codeFont}
              options={CODE_FONTS.map((f) => ({ value: f.id, label: f.label }))}
              onChange={(v) => setTy({ ...ty, codeFont: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="font-size">Font size</label>
            <div className="flex min-w-0 items-center gap-2">
              <input
                id="font-size"
                type="range"
                className="min-w-0 accent-accent"
                {...FONT_SIZE_RANGE}
                value={ty.fontSize}
                onChange={(e) =>
                  setTy({ ...ty, fontSize: clampFontSize(e.currentTarget.valueAsNumber) })
                }
              />
              <output htmlFor="font-size" className="w-10 text-right tabular-nums">
                {ty.fontSize}px
              </output>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="line-height">Line height</label>
            <div className="flex min-w-0 items-center gap-2">
              <input
                id="line-height"
                type="range"
                className="min-w-0 accent-accent"
                {...LINE_HEIGHT_RANGE}
                value={ty.lineHeight}
                onChange={(e) =>
                  setTy({
                    ...ty,
                    lineHeight: clampLineHeight(e.currentTarget.valueAsNumber),
                  })
                }
              />
              <output htmlFor="line-height" className="w-10 text-right tabular-nums">
                {ty.lineHeight.toFixed(1)}
              </output>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p>Ligatures</p>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Ligatures"
              aria-pressed={ty.ligatures}
              onClick={() => setTy({ ...ty, ligatures: !ty.ligatures })}
            >
              {ty.ligatures ? 'On' : 'Off'}
            </Button>
          </div>
        </section>

        <section aria-labelledby="editing-h" className="mt-5 space-y-2">
          <h3 id="editing-h" className="text-xs tracking-wide text-muted uppercase">
            Editing
          </h3>
          <div className="flex items-center justify-between gap-3">
            <p>Vim mode</p>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Vim mode"
              aria-pressed={vim}
              onClick={() => setVim(!vim)}
            >
              {vim ? 'On' : 'Off'}
            </Button>
          </div>
          <p className="text-muted">
            Modal editing with motions, text objects and : commands. :Explore opens the
            file tree.
          </p>
        </section>
        <AiSettings />
      </div>
    </div>
  )
}
