import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getDefaultStore } from 'jotai'
import App from './App'
import './index.css'
import { handlePreloadError, registerServiceWorker } from './pwa/register'
import { applyTheme, loadTheme, watchSystemTheme } from './lib/theme'
import { applyTypography, loadTypography } from './lib/typography'

applyTheme(loadTheme())
watchSystemTheme()
applyTypography(loadTypography())

const store = getDefaultStore()
handlePreloadError(store)
registerServiceWorker(store)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
