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
  var id = 'system'
  try {
    id = localStorage.getItem('daedalus:theme') || 'system'
  } catch (e) {
    /* storage unavailable: fall through to the system setting */
  }
  if (id === 'light') id = 'paper'
  else if (id === 'dark') id = 'deep-slate'
  if (IDS.indexOf(id) < 0) {
    id =
      window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
        ? 'deep-slate'
        : 'paper'
  }
  var root = document.documentElement
  root.setAttribute('data-theme', id)
  root.classList.add(DARK.indexOf(id) >= 0 ? 'dark' : 'light')
})()
