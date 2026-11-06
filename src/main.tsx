import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './pwa/register'
import { applyTheme, loadTheme, watchSystemTheme } from './lib/theme'
import { applyTypography, loadTypography } from './lib/typography'

applyTheme(loadTheme())
watchSystemTheme()
applyTypography(loadTypography())

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
