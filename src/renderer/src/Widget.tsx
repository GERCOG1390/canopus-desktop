// Overlay mini-windows over the game: timers of every character, a quick Jita price lookup, and
// the characters' wallets. Same frame as the intel overlay; drag by the header, resize by the edges.

import { useEffect, useState, type ReactNode } from 'react'
import type { CharacterAuth } from '../../shared/types'
import type { WidgetView } from '../../shared/widgets'
import type { RadarStatus } from '../../shared/radar'
import { setUiLang, translate } from './i18n'
import { esi } from './lib/esi'
import { fmtDuration, fmtIsk } from './lib/format'
import { jitaPrices } from './lib/market'
import { searchTypesSde, type Lang } from './lib/sde'
import { loadRow, type Row } from './pages/character/AllCharacters'

const TITLES: Record<WidgetView, string> = { timers: 'Таймеры', price: 'Цена в Jita', wallet: 'Кошелёк', radar: 'Радар убийств' }

export default function Widget({ view }: { view: WidgetView }) {
  const [lang, setLang] = useState<Lang>(1)
  const [chars, setChars] = useState<CharacterAuth[]>([])
  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    void window.api.settings.get().then((s) => {
      setUiLang(s.lang === 'en' ? 'en' : 'ru')
      setLang(s.lang === 'en' ? 0 : 1)
    })
    void window.api.auth.characters().then(setChars)
  }, [])
  return (
    <div className="ov widget">
      <div className="ov-head">
        <span className="ov-system">{translate(TITLES[view])}</span>
        <span className="ov-actions">
          <button title={translate('Скрыть')} onClick={() => void window.api.widgets.set(view, false)}>
            ✕
          </button>
        </span>
      </div>
      <div className="widget-body">
        {view === 'timers' && <Timers chars={chars} />}
        {view === 'price' && <Price lang={lang} />}
        {view === 'wallet' && <Wallet chars={chars} />}
        {view === 'radar' && <Radar />}
      </div>
    </div>
  )
}

/** Refreshes `load` every few minutes; returns its latest result. */
function usePoll<T>(load: () => Promise<T>, deps: unknown[], everyMs: number): T | null {
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    const run = () => void load().then((d) => alive && setData(d)).catch(() => {})
    run()
    const t = setInterval(run, everyMs)
    return () => {
      alive = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return data
}

const left = (t: number | null | undefined, now: number): ReactNode =>
  t === undefined ? '—' : t === null || t <= now ? <span className="bad">{translate('сейчас')}</span> : fmtDuration(t - now)

function Timers({ chars }: { chars: CharacterAuth[] }) {
  const rows = usePoll<Row[]>(() => Promise.all(chars.map(loadRow)), [chars.map((c) => c.id).join(',')], 5 * 60_000)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  if (!chars.length) return <div className="muted">{translate('Войдите персонажем в Canopus')}</div>
  if (!rows) return <div className="muted">…</div>
  return (
    <table className="widget-table">
      <thead>
        <tr>
          <th />
          <th>{translate('Навыки')}</th>
          <th>PI</th>
          <th>{translate('Работы')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td translate="no">{r.name.split(' ')[0]}</td>
            <td>{r.queueEnd === null ? <span className="bad">{translate('пусто')}</span> : left(r.queueEnd, now)}</td>
            <td>{!r.pi?.planets || r.pi.earliest === null ? '—' : left(r.pi.earliest, now)}</td>
            <td>{r.jobs ? (r.jobs.ready ? <span className="good">{`✔ ${r.jobs.ready}`}</span> : r.jobs.active || '—') : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Price({ lang }: { lang: Lang }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<{ id: number; name: string }[]>([])
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null)
  const [price, setPrice] = useState<{ sell: number; buy: number } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (q.trim().length < 3) return setItems([])
    const t = setTimeout(() => void searchTypesSde(q, lang, { marketOnly: true }).then((r) => setItems(r.slice(0, 6))), 250)
    return () => clearTimeout(t)
  }, [q, lang])
  useEffect(() => {
    if (!picked) return
    setPrice(null)
    void jitaPrices([picked.id]).then((m) => {
      const p = m.get(picked.id)
      setPrice(p ? { sell: p.sell.best, buy: p.buy.best } : { sell: 0, buy: 0 })
    })
  }, [picked?.id])
  const copy = (v: number, key: string) => {
    void navigator.clipboard.writeText(String(Math.round(v * 100) / 100))
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }
  return (
    <>
      <input className="widget-input" placeholder={translate('Предмет…')} value={q} onChange={(e) => setQ(e.target.value)} />
      {items.length > 0 && !picked && (
        <ul className="widget-list">
          {items.map((i) => (
            <li key={i.id}>
              <button className="gx-link" onClick={() => (setPicked(i), setItems([]), setQ(i.name))}>
                {i.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="widget-price">
          <div className="muted" translate="no">
            {picked.name}{' '}
            <button className="gx-link" onClick={() => (setPicked(null), setQ(''))}>
              ✕
            </button>
          </div>
          {!price ? (
            <div className="muted">…</div>
          ) : (
            <>
              <div>
                {translate('Продажа')} <b>{fmtIsk(price.sell)}</b>{' '}
                <button className="ghost small" onClick={() => copy(price.sell, 'sell')}>
                  {copied === 'sell' ? '✔' : '⧉'}
                </button>
              </div>
              <div>
                {translate('Покупка')} <b>{fmtIsk(price.buy)}</b>{' '}
                <button className="ghost small" onClick={() => copy(price.buy, 'buy')}>
                  {copied === 'buy' ? '✔' : '⧉'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

/** Kills near the pilot and on the route, newest first; camps, bubbles and smartbombs highlighted. */
function Radar() {
  const [status, setStatus] = useState<RadarStatus | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const load = () => void window.api.radar.status().then(setStatus)
    load()
    const offKill = window.api.radar.onKill(load)
    const offStatus = window.api.radar.onStatus(setStatus)
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      offKill()
      offStatus()
      clearInterval(t)
    }
  }, [])
  if (!status) return <div className="muted">…</div>
  if (!status.enabled) return <div className="muted">{translate('Радар выключен: Разведка → Радар убийств')}</div>
  const kills = status.kills.filter((k) => now - Date.parse(k.time) < 30 * 60_000)
  return (
    <>
      <div className="muted small" translate="no">
        {status.here ? `${status.here.name} · ${status.watched}` : '—'}
        {status.error ? ` · ${status.error}` : ''}
      </div>
      {!kills.length ? (
        <div className="muted">{translate('Рядом тихо')}</div>
      ) : (
        <ul className="widget-list radar-widget">
          {kills.slice(0, 12).map((k) => {
            const min = Math.max(0, Math.floor((now - Date.parse(k.time)) / 60_000))
            const flags = [k.camp && translate('кемп'), k.bubbles && translate('бубли'), k.smartbombs && translate('смартбомбы')].filter(Boolean).join(', ')
            return (
              <li key={k.id} className={flags ? 'bad' : ''} title={k.attackerShips.join(', ')} translate="no">
                <b>{k.system}</b> {k.jumps === undefined ? '↦' : k.jumps === 0 ? translate('здесь') : `${k.jumps}j`}
                {k.gate ? ` → ${k.gate.toName}` : ''} · {flags ? `${flags} · ` : ''}
                {k.victimShipName} · {min < 1 ? translate('сейчас') : `${min}m`}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function Wallet({ chars }: { chars: CharacterAuth[] }) {
  const rows = usePoll(
    () => Promise.all(chars.map(async (c) => ({ c, isk: await esi<number>(`/characters/${c.id}/wallet/`, { characterId: c.id }).catch(() => null) }))),
    [chars.map((c) => c.id).join(',')],
    2 * 60_000
  )
  if (!chars.length) return <div className="muted">{translate('Войдите персонажем в Canopus')}</div>
  if (!rows) return <div className="muted">…</div>
  const total = rows.reduce((a, r) => a + (r.isk ?? 0), 0)
  return (
    <table className="widget-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.c.id}>
            <td translate="no">{r.c.name}</td>
            <td className="num">{r.isk === null ? '—' : fmtIsk(r.isk, true)}</td>
          </tr>
        ))}
        {rows.length > 1 && (
          <tr className="widget-total">
            <td>{translate('Всего')}</td>
            <td className="num">{fmtIsk(total, true)}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
