import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startAppearance } from './theme'
import './styles.css'

// "native" inside the Electron window (its sidebar shows the window's vibrancy material), "web" in a browser tab (the local web
// access of Settings), where the sidebar is opaque. Set before the first render so the first paint is already right.
document.documentElement.dataset.chrome = window.ppd ? 'native' : 'web'
// The theme the owner chose and the animated background (Settings, Appearance), also before the first render; see theme.ts.
startAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
