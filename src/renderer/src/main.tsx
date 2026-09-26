import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
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

// The overlay window loads the same bundle with #overlay.
const isOverlay = location.hash === '#overlay'

createRoot(document.getElementById('root')!).render(<StrictMode>{isOverlay ? <Overlay /> : <App />}</StrictMode>)
