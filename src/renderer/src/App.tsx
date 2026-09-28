import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppProvider, useApp, type PageId } from './AppContext'
import { CharacterProvider } from './CharacterContext'
import { CommandPalette, type NavPage } from './components/CommandPalette'
import { BrandMark, Glyph, type GlyphName } from './components/Glyph'
import { InfoProvider } from './components/InfoContext'
import { InfoPanel } from './components/InfoPanel'
import { imageUrl } from './lib/esi'
import { fmtNum } from './lib/format'
import { FittingProvider } from './lib/fitting'
import { useUpdate } from './lib/update'
import CharacterPage from './pages/character'
import FittingPage from './pages/FittingPage'
import IntelPage from './pages/IntelPage'
import { IntelProvider, useIntel } from './IntelContext'
import IndustryPage from './pages/IndustryPage'
import MapPage from './pages/MapPage'
import MarketPage from './pages/MarketPage'
import PvpPage from './pages/PvpPage'
import ActivitiesPage from './pages/ActivitiesPage'
import MailPage from './pages/MailPage'
import FleetPage from './pages/FleetPage'
import SettingsPage from './pages/SettingsPage'

const PAGES: (NavPage & { render: () => ReactNode })[] = [
  { id: 'character', label: 'Персонаж', group: 'Пилот', icon: 'character', render: () => <CharacterPage /> },
  { id: 'mail', label: 'Почта', group: 'Пилот', icon: 'mail', render: () => <MailPage /> },
  { id: 'fleet', label: 'Флот', group: 'Пилот', icon: 'fleet', render: () => <FleetPage /> },
  { id: 'intel', label: 'Разведка', group: 'Бой', icon: 'intel', render: () => <IntelPage /> },
  { id: 'fitting', label: 'Фитинг', group: 'Бой', icon: 'fitting', render: () => <FittingPage /> },
  { id: 'pvp', label: 'PvP', group: 'Бой', icon: 'pvp', render: () => <PvpPage /> },
  { id: 'market', label: 'Рынок', group: 'Экономика', icon: 'market', render: () => <MarketPage /> },
  { id: 'industry', label: 'Индустрия', group: 'Экономика', icon: 'industry', render: () => <IndustryPage /> },
  { id: 'map', label: 'Карта', group: 'Космос', icon: 'map', render: () => <MapPage /> },
  { id: 'activities', label: 'Активности', group: 'Космос', icon: 'activities', render: () => <ActivitiesPage /> },
  { id: 'settings', label: 'Настройки', group: '', icon: 'settings', render: () => <SettingsPage /> }
]
const GROUPS = ['Пилот', 'Бой', 'Экономика', 'Космос']

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

/** Tranquility status from ESI: player count, or offline. */
function ServerStatus() {
  const [players, setPlayers] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    const load = () =>
      window.api
        .request<{ players: number }>('https://esi.evetech.net/latest/status/?datasource=tranquility', { fresh: true })
        .then((r) => setPlayers(r.players))
        .catch(() => setPlayers(null))
    void load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])
  if (players === undefined) return null
  return (
    <div className="status-chip" title="Сервер Tranquility">
      <span className={players === null ? 'led off' : 'led'} />
      {players === null ? 'Tranquility · нет связи' : `Tranquility · ${fmtNum(players)}`}
    </div>
  )
}

/** EVE time is UTC. */
function EveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="eve-clock" title="Время EVE (UTC)" translate="no">
      EVE {now.toISOString().slice(11, 16)}
    </span>
  )
}

/**
 * In-app alert when a dangerous pilot shows up in Local (the Windows notification may be off or
 * missed while the game has focus). Threats arrive a few at a time, so each pilot is shown once.
 */
function DangerToast() {
  const { scan } = useIntel()
  const { navigate } = useApp()
  const seen = useRef(new Set<number>())
  const [shown, setShown] = useState<string[]>([])
  useEffect(() => {
    if (!scan) return
    const fresh = scan.pilots.filter((p) => scan.arrived.has(p.id) && (p.threat === 'hostile' || p.threat === 'high') && !seen.current.has(p.id))
    if (!fresh.length) return
    for (const p of fresh) seen.current.add(p.id)
    setShown(fresh.map((p) => p.name))
    const t = setTimeout(() => setShown([]), 12_000)
    return () => clearTimeout(t)
  }, [scan])
  if (!shown.length) return null
  return (
    <div className="danger-toast" role="alert">
      <Glyph name="alert" size={20} className="danger-toast-icon" />
      <div className="grow">
        <b>{shown.length > 1 ? `Опасные пилоты в локале: ${shown.length}` : 'Опасный пилот вошёл в локал'}</b>
        <div className="muted" translate="no">
          {shown.slice(0, 3).join(', ')}
          {shown.length > 3 ? '…' : ''}
        </div>
        <div className="row">
          <button
            className="danger-fill"
            onClick={() => {
              navigate('intel')
              setShown([])
            }}
          >
            Показать
          </button>
          <button className="ghost" onClick={() => setShown([])}>
            Скрыть
          </button>
        </div>
      </div>
    </div>
  )
}

function NavButton({ p, badge, danger }: { p: NavPage; badge?: ReactNode; danger?: boolean }) {
  const { page, navigate } = useApp()
  return (
    <button className={p.id === page ? 'nav active' : 'nav'} aria-current={p.id === page ? 'page' : undefined} onClick={() => navigate(p.id)}>
      <span className="nav-icon">
        <Glyph name={p.icon as GlyphName} />
      </span>
      {p.label}
      {badge !== undefined && badge !== null && badge !== 0 && <span className={danger ? 'nav-badge danger' : 'nav-badge'}>{badge}</span>}
    </button>
  )
}

/** Remounts the UI when the language changes so every text node is re-rendered. */
function LanguageScope({ children }: { children: ReactNode }) {
  const { settings } = useApp()
  return <Fragment key={settings?.lang ?? 'ru'}>{children}</Fragment>
}

function Shell() {
  const { active, characters, settings, page, navigate } = useApp()
  const { scan } = useIntel()
  const [palette, setPalette] = useState(false)
  const needsSetup = settings !== null && characters.length === 0
  const current = PAGES.find((p) => p.id === page)!
  const dangerous = scan?.pilots.filter((p) => p.threat === 'hostile' || p.threat === 'high').length ?? 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault()
        setPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Разделы">
        <div className="brand">
          <span className="brand-star">
            <BrandMark size={26} />
          </span>
          <span translate="no">CANOPUS</span>
        </div>
        {GROUPS.map((g) => (
          <Fragment key={g}>
            <div className="nav-group">{g}</div>
            {PAGES.filter((p) => p.group === g).map((p) => (
              <NavButton key={p.id} p={p} badge={p.id === 'intel' ? dangerous : undefined} danger />
            ))}
          </Fragment>
        ))}
        <div className="grow" />
        <NavButton p={PAGES.find((p) => p.id === 'settings')!} badge={needsSetup ? '●' : undefined} />
        {active ? (
          <button className="sidebar-char" onClick={() => navigate('settings')} title="Персонажи и вход">
            <img src={imageUrl.portrait(active.id, 64)} width={34} height={34} alt="" />
            <span className="sidebar-char-name">
              <span translate="no">{active.name}</span>
              <span className="muted small">{characters.length > 1 ? `персонажей: ${characters.length}` : 'сменить персонажа'}</span>
            </span>
          </button>
        ) : (
          <button className="sidebar-char" onClick={() => navigate('settings')}>
            Войти через EVE SSO
          </button>
        )}
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            {current.group && (
              <>
                <span>{current.group}</span>
                <Glyph name="chevron" size={14} />
              </>
            )}
            <h1>{current.label}</h1>
          </div>
          <div className="grow" />
          <button className="palette-trigger" onClick={() => setPalette(true)}>
            <Glyph name="search" size={16} />
            <span className="grow">Найти предмет, раздел или команду…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="grow" />
          <ServerStatus />
          <EveClock />
        </header>
        <main className="content">
          <SdeBanner />
          <UpdateBanner />
          {current.render()}
        </main>
      </div>
      <InfoPanel />
      <CommandPalette pages={PAGES} open={palette} onClose={() => setPalette(false)} />
      <DangerToast />
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
