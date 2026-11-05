// Runs synchronously in <head>, before first paint, so a reload shows the saved
// theme immediately. Keep the ids in sync with THEMES in src/lib/themes.ts
// (src/lib/themes.test.ts checks this). Classic script on purpose: the CSP allows
// same-origin scripts only, and this must not be a module.
;(function () {
  var IDS = [
    'paper',
    'github-light',
    'solarized-light',
    'one-light',
    'deep-slate',
    'github-dark',
    'one-dark',
    'dracula',
  ]
  var DARK = ['deep-slate', 'github-dark', 'one-dark', 'dracula']
  var raw = null
  try {
    raw = localStorage.getItem('daedalus:theme')
  } catch (e) {
    /* storage unavailable: fall through to the defaults */
  }
  var light = 'paper'
  var dark = 'deep-slate'
  var mode = 'system'
  if (raw === 'light' || raw === 'dark') mode = raw
  else if (IDS.indexOf(raw) >= 0) {
    mode = DARK.indexOf(raw) >= 0 ? 'dark' : 'light'
    if (mode === 'dark') dark = raw
    else light = raw
  } else if (raw) {
    try {
      var v = JSON.parse(raw) || {}
      if (v.mode === 'light' || v.mode === 'dark') mode = v.mode
      if (IDS.indexOf(v.light) >= 0 && DARK.indexOf(v.light) < 0) light = v.light
      if (DARK.indexOf(v.dark) >= 0) dark = v.dark
    } catch (e) {
      /* unreadable value: keep the defaults */
    }
  }
  if (mode === 'system') {
    mode =
      window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
  }
  var id = mode === 'dark' ? dark : light
  var root = document.documentElement
  root.setAttribute('data-theme', id)
  root.classList.add(DARK.indexOf(id) >= 0 ? 'dark' : 'light')

  // Typography: same variables as applyTypography in src/lib/typography.ts. The font
  // files themselves still load on demand from the app bundle.
  var UI = {
    'space-grotesk': "'Space Grotesk'",
    'instrument-sans': "'Instrument Sans'",
    'plus-jakarta-sans': "'Plus Jakarta Sans'",
    satoshi: "'Satoshi'",
    system: '',
  }
  var CODE = {
    'jetbrains-mono': "'JetBrains Mono'",
    'geist-mono': "'Geist Mono'",
    'ibm-plex-mono': "'IBM Plex Mono'",
    'cascadia-code': "'Cascadia Code'",
    'fira-code': "'Fira Code'",
    iosevka: "'Iosevka'",
    'source-code-pro': "'Source Code Pro'",
    inconsolata: "'Inconsolata'",
  }
  var SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
  var MONO =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
  var ty = null
  try {
    ty = JSON.parse(localStorage.getItem('daedalus:typography') || 'null')
  } catch (e) {
    /* unreadable value: keep the defaults */
  }
  ty = ty || {}
  var ui = UI.hasOwnProperty(ty.uiFont) ? ty.uiFont : 'space-grotesk'
  var code = CODE.hasOwnProperty(ty.codeFont) ? ty.codeFont : 'jetbrains-mono'
  var size =
    typeof ty.fontSize === 'number'
      ? Math.min(24, Math.max(12, Math.round(ty.fontSize)))
      : 14
  var lh =
    typeof ty.lineHeight === 'number'
      ? Math.min(1.8, Math.max(1.3, Math.round(ty.lineHeight * 10) / 10))
      : 1.5
  var st = root.style
  st.setProperty('--font-sans', (UI[ui] ? UI[ui] + ', ' : '') + SANS)
  var mono = CODE[code] + ', ' + MONO
  st.setProperty('--font-mono', mono)
  st.setProperty('--font-code', mono)
  st.setProperty('--editor-font-size', size + 'px')
  st.setProperty('--editor-line-height', String(lh))
  st.setProperty('--editor-ligatures', ty.ligatures === false ? 'none' : 'normal')
})()
