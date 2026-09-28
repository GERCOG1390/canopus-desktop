import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CombatWindow from './CombatWindow'
import Overlay from './Overlay'
import '@fontsource/exo-2/500.css'
import '@fontsource/exo-2/600.css'
import '@fontsource/exo-2/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles.css'
import { applyAppearance } from './lib/appearance'

// Open plain <a target="_blank"> links in the system browser.
document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest('a[href^="https://"]') as HTMLAnchorElement | null
  if (link) {
    e.preventDefault()
    void window.api.openExternal(link.href)
  }
})

// Every window (main, overlay, combat simulator) takes the theme and density from the settings.
void window.api.settings.get().then(applyAppearance)
window.api.onSettingsChanged(() => void window.api.settings.get().then(applyAppearance))

// The overlay and the combat simulator windows load the same bundle with #overlay / #combat.
const view = location.hash === '#overlay' ? <Overlay /> : location.hash === '#combat' ? <CombatWindow /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>)
