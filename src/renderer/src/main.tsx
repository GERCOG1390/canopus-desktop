import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CombatWindow from './CombatWindow'
import FitShot from './FitShot'
import Overlay from './Overlay'
import Widget from './Widget'
import Previews from './Previews'
import { WIDGET_VIEWS, type WidgetView } from '../../shared/widgets'
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

// The overlay, its mini-windows and the combat simulator load the same bundle with #overlay,
// #widget-<view>, #combat and #fitshot.
const widget = /^#widget-(\w+)$/.exec(location.hash)?.[1] as WidgetView | undefined
const view =
  location.hash === '#overlay' ? <Overlay /> : location.hash === '#previews' ? <Previews /> : widget && WIDGET_VIEWS.includes(widget) ? <Widget view={widget} /> : location.hash === '#combat' ? <CombatWindow /> : location.hash === '#fitshot' ? <FitShot /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>)
