import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CombatWindow from './CombatWindow'
import Overlay from './Overlay'
import './styles.css'

// Open plain <a target="_blank"> links in the system browser.
document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest('a[href^="https://"]') as HTMLAnchorElement | null
  if (link) {
    e.preventDefault()
    void window.api.openExternal(link.href)
  }
})

// The overlay and the combat simulator windows load the same bundle with #overlay / #combat.
const view = location.hash === '#overlay' ? <Overlay /> : location.hash === '#combat' ? <CombatWindow /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>)
