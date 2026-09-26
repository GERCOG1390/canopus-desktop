import { useState, type ReactNode } from 'react'
import { AppProvider, useApp } from './AppContext'
import { imageUrl } from './lib/esi'
import CharacterPage from './pages/CharacterPage'
import IndustryPage from './pages/IndustryPage'
import MapPage from './pages/MapPage'
import MarketPage from './pages/MarketPage'
import PvpPage from './pages/PvpPage'
import SettingsPage from './pages/SettingsPage'

type PageId = 'character' | 'market' | 'map' | 'industry' | 'pvp' | 'settings'

const PAGES: { id: PageId; label: string; icon: string; render: () => ReactNode }[] = [
  { id: 'character', label: 'Персонаж', icon: '◉', render: () => <CharacterPage /> },
  { id: 'market', label: 'Рынок', icon: '◈', render: () => <MarketPage /> },
  { id: 'map', label: 'Карта', icon: '✦', render: () => <MapPage /> },
  { id: 'industry', label: 'Индустрия', icon: '⚙', render: () => <IndustryPage /> },
  { id: 'pvp', label: 'PvP', icon: '✕', render: () => <PvpPage /> },
  { id: 'settings', label: 'Настройки', icon: '☰', render: () => <SettingsPage /> }
]

function Shell() {
  const { active, characters, settings } = useApp()
  const needsSetup = settings !== null && (!settings.clientId || characters.length === 0)
  const [page, setPage] = useState<PageId>('market')
  const current = PAGES.find((p) => p.id === page)!

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-star">✧</span> Canopus
        </div>
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === page ? 'nav active' : 'nav'} onClick={() => setPage(p.id)}>
            <span className="nav-icon">{p.icon}</span>
            {p.label}
            {p.id === 'settings' && needsSetup && <span className="dot" title="Требуется настройка" />}
          </button>
        ))}
        <div className="grow" />
        {active ? (
          <button className="sidebar-char" onClick={() => setPage('settings')}>
            <img src={imageUrl.portrait(active.id, 64)} width={32} height={32} alt="" />
            <span>{active.name}</span>
          </button>
        ) : (
          <button className="sidebar-char muted" onClick={() => setPage('settings')}>
            Войти через EVE SSO
          </button>
        )}
      </nav>
      <main className="content">
        <h1>{current.label}</h1>
        {current.render()}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
