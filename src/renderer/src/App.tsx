import { Fragment, type ReactNode } from 'react'
import { AppProvider, useApp, useLang, type PageId } from './AppContext'
import { CharacterProvider } from './CharacterContext'
import { InfoProvider, useInfo } from './components/InfoContext'
import { InfoPanel } from './components/InfoPanel'
import { TypeLink } from './components/TypeLink'
import { SearchBox } from './components/ui'
import { imageUrl } from './lib/esi'
import { searchTypesSde } from './lib/sde'
import { FittingProvider } from './lib/fitting'
import { useUpdate } from './lib/update'
import CharacterPage from './pages/character'
import FittingPage from './pages/FittingPage'
import IntelPage from './pages/IntelPage'
import { IntelProvider } from './IntelContext'
import IndustryPage from './pages/IndustryPage'
import MapPage from './pages/MapPage'
import MarketPage from './pages/MarketPage'
import PvpPage from './pages/PvpPage'
import ActivitiesPage from './pages/ActivitiesPage'
import MailPage from './pages/MailPage'
import FleetPage from './pages/FleetPage'
import SettingsPage from './pages/SettingsPage'

const PAGES: { id: PageId; label: string; icon: string; render: () => ReactNode }[] = [
  { id: 'character', label: 'Персонаж', icon: '◉', render: () => <CharacterPage /> },
  { id: 'intel', label: 'Разведка', icon: '◎', render: () => <IntelPage /> },
  { id: 'fitting', label: 'Фитинг', icon: '⬡', render: () => <FittingPage /> },
  { id: 'market', label: 'Рынок', icon: '◈', render: () => <MarketPage /> },
  { id: 'map', label: 'Карта', icon: '✦', render: () => <MapPage /> },
  { id: 'industry', label: 'Индустрия', icon: '⚙', render: () => <IndustryPage /> },
  { id: 'activities', label: 'Активности', icon: '◇', render: () => <ActivitiesPage /> },
  { id: 'mail', label: 'Почта', icon: '✉', render: () => <MailPage /> },
  { id: 'fleet', label: 'Флот', icon: '⚑', render: () => <FleetPage /> },
  { id: 'pvp', label: 'PvP', icon: '✕', render: () => <PvpPage /> },
  { id: 'settings', label: 'Настройки', icon: '☰', render: () => <SettingsPage /> }
]

function SdeBanner() {
  const { sde } = useApp()
  if (sde.state === 'ready' || sde.state === 'idle') return null
  const label =
    sde.state === 'downloading'
      ? `Скачиваю базу данных EVE (SDE)… ${Math.round((sde.progress ?? 0) * 100)}%`
      : sde.state === 'building'
        ? `Обрабатываю SDE: ${sde.message ?? ''}`
        : sde.state === 'checking'
          ? 'Проверяю обновления SDE…'
          : `Ошибка SDE: ${sde.message}`
  return (
    <div className={`sde-banner ${sde.state === 'error' ? 'error' : ''}`}>
      {label}
      {(sde.state === 'downloading' || sde.state === 'building') && (
        <div className="progress">
          <div style={{ width: `${(sde.progress ?? 0) * 100}%` }} />
        </div>
      )}
    </div>
  )
}

/** A newer version: downloading, ready to install, or (for builds that can't update themselves) a link. */
function UpdateBanner() {
  const u = useUpdate()
  const { navigate } = useApp()
  if (!u || !u.version || (u.state !== 'available' && u.state !== 'downloading' && u.state !== 'ready')) return null
  return (
    <div className="sde-banner update-banner">
      <div className="row">
        <span className="grow">
          {u.state === 'ready'
            ? `Canopus ${u.version} загружен — установится при перезапуске.`
            : u.state === 'downloading'
              ? `Загружаю Canopus ${u.version}… ${Math.round((u.progress ?? 0) * 100)}%`
              : `Вышла новая версия Canopus ${u.version}.`}
        </span>
        {u.state === 'ready' && <button onClick={() => void window.api.update.installAndRestart()}>Перезапустить и обновить</button>}
        {u.state === 'available' && u.kind !== 'manual' && <button onClick={() => void window.api.update.download()}>Скачать</button>}
        {u.state === 'available' && u.kind === 'manual' && u.page && <button onClick={() => void window.api.openExternal(u.page!)}>Открыть страницу загрузки</button>}
        <button className="ghost" onClick={() => navigate('settings')}>
          Что нового
        </button>
      </div>
      {u.state === 'downloading' && (
        <div className="progress">
          <div style={{ width: `${(u.progress ?? 0) * 100}%` }} />
        </div>
      )}
    </div>
  )
}

function GlobalSearch() {
  const lang = useLang()
  const { open } = useInfo()
  const { sde } = useApp()
  return (
    <div className="global-search">
      <SearchBox
        placeholder={sde.state === 'ready' ? 'Поиск: корабль, модуль, навык, имплант…' : 'База SDE загружается…'}
        search={(q) => searchTypesSde(q, lang)}
        onSelect={(t) => open(t.id)}
        clearOnSelect
        renderItem={(t) => (
          <>
            <TypeLink id={t.id} />
            {t.alt && <span className="muted small"> {t.alt}</span>}
          </>
        )}
      />
    </div>
  )
}

/** Remounts the UI when the language changes so every text node is re-rendered. */
function LanguageScope({ children }: { children: ReactNode }) {
  const { settings } = useApp()
  return <Fragment key={settings?.lang ?? 'ru'}>{children}</Fragment>
}

function Shell() {
  const { active, characters, settings, page, navigate } = useApp()
  const needsSetup = settings !== null && characters.length === 0
  const current = PAGES.find((p) => p.id === page)!

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-star">✧</span> Canopus
        </div>
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === page ? 'nav active' : 'nav'} onClick={() => navigate(p.id)}>
            <span className="nav-icon">{p.icon}</span>
            {p.label}
            {p.id === 'settings' && needsSetup && <span className="dot" title="Требуется настройка" />}
          </button>
        ))}
        <div className="grow" />
        {active ? (
          <button className="sidebar-char" onClick={() => navigate('settings')}>
            <img src={imageUrl.portrait(active.id, 64)} width={32} height={32} alt="" />
            <span>{active.name}</span>
          </button>
        ) : (
          <button className="sidebar-char muted" onClick={() => navigate('settings')}>
            Войти через EVE SSO
          </button>
        )}
      </nav>
      <main className="content">
        <SdeBanner />
        <UpdateBanner />
        <div className="page-head">
          <h1>{current.label}</h1>
          <GlobalSearch />
        </div>
        {current.render()}
      </main>
      <InfoPanel />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <CharacterProvider>
        <FittingProvider>
          <IntelProvider>
            <InfoProvider>
              <LanguageScope>
                <Shell />
              </LanguageScope>
            </InfoProvider>
          </IntelProvider>
        </FittingProvider>
      </CharacterProvider>
    </AppProvider>
  )
}
