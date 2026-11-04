import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import { getDefaultStore } from 'jotai'
import App from './App'
import './index.css'
import { handlePreloadError, registerServiceWorker } from './pwa/register'
import { applyTheme, loadTheme, watchSystemTheme } from './lib/theme'

applyTheme(loadTheme())
watchSystemTheme()

const store = getDefaultStore()
handlePreloadError(store)
registerServiceWorker(store)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
