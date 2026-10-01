import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useIntel } from '../IntelContext'
import { Card, Empty, Stat, Tabs } from '../components/ui'
import { locale, translate } from '../i18n'
import type { CombatLogEvent } from '../../../shared/ratting'
import { fmtDate, fmtDuration, fmtIsk, fmtNum } from '../lib/format'
import { useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { SearchBox } from '../components/ui'
import { jitaPrices, parseItemList } from '../lib/market'
import { CATEGORY, searchTypesSde, tn, useTypeBasic } from '../lib/sde'
import { useAsync, useTick } from '../lib/useAsync'
import Mining from './Mining'

type Tab = 'sigs' | 'ratting' | 'mining' | 'abyss'

export default function ActivitiesPage() {
  const [tab, setTab] = useState<Tab>('sigs')
  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'sigs', label: 'Сигнатуры' },
          { id: 'ratting', label: 'Крабинг' },
          { id: 'mining', label: 'Добыча' },
          { id: 'abyss', label: 'Абиссы' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'sigs' && <Signatures />}
      {tab === 'ratting' && <RattingTracker />}
      {tab === 'mining' && <Mining />}
      {tab === 'abyss' && <AbyssTracker />}
    </div>
  )
}

// ---------------- Probe scanner signatures ----------------

type SigKind = 'data' | 'relic' | 'gas' | 'wormhole' | 'combat' | 'ore' | 'unknown'

interface Sig {
  id: string
  group: string
  type: string
  name: string
  strength: number
  distance: string
  kind: SigKind
  anomaly: boolean
}

const KIND_LABEL: Record<SigKind, string> = {
  data: 'Данные',
  relic: 'Реликвии',
  gas: 'Газ',
  wormhole: 'Вормхол',
  combat: 'Боевой',
  ore: 'Руда',
  unknown: 'Не определено'
}

/** Signature type from the scanner's "type" column, English or Russian client. */
function kindOf(type: string, name: string): SigKind {
  const t = `${type} ${name}`
  if (/wormhole|червоточ/i.test(t)) return 'wormhole'
  if (/data|данн/i.test(t)) return 'data'
  if (/relic|рели[кв]/i.test(t)) return 'relic'
  if (/gas|газ/i.test(t)) return 'gas'
  if (/ore|руд|астероид/i.test(t)) return 'ore'
  if (/combat|боев/i.test(t)) return 'combat'
  return 'unknown'
}

/** Probe scanner copy: ID, group, type, name, signal strength, distance (tab separated). */
function parseSigs(text: string): Sig[] {
  const out: Sig[] = []
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t').map((x) => x.trim())
    if (!/^[A-Z]{3}-\d{3}$/.test(c[0] ?? '')) continue
    const [id, group = '', type = '', name = '', strength = '0', distance = ''] = c
    out.push({
      id,
      group,
      type,
      name,
      strength: Number(strength.replace('%', '').replace(',', '.')) || 0,
      distance,
      kind: kindOf(type, name),
      anomaly: /anomal|аномал/i.test(group)
    })
  }
  return out
}

/** What to expect at a site, from its name (tiers of data / relic sites, NPC hazards). */
function hint(s: Sig): { text: string; level: 'low' | 'mid' | 'high' | 'warn' } | null {
  const n = s.name
  if (s.kind === 'wormhole') return { text: 'Код дыры виден после варпа — проверьте его во вкладке «Карта → Вормхолы»', level: 'mid' }
  if (!n) return null
  if (/covert research|ghost|скрыт.*исследов/i.test(n)) return { text: 'Ghost site: вскоре после начала взлома прилетят NPC, неудачный взлом взрывает контейнер', level: 'warn' }
  if (/forgotten|unsecured|sleeper|забыт|незащищ/i.test(n)) return { text: 'Сайт Sleeper: высокая ценность, часто охраняется дронами Sleeper', level: 'high' }
  if (s.kind === 'data' || s.kind === 'relic') {
    if (/^(local|crumbling|местн|рассыпа)/i.test(n)) return { text: 'Низкий уровень: мало ценностей', level: 'low' }
    if (/^(regional|decayed|регион|разлага)/i.test(n)) return { text: 'Средний уровень', level: 'mid' }
    if (/^(central|ruined|централ|разрушен)/i.test(n)) return { text: 'Высокий уровень: самые ценные контейнеры', level: 'high' }
  }
  if (s.kind === 'gas') {
    if (/perimeter|frontier|core|periphery|reservoir|периметр|фронт|ядро|резерв/i.test(n)) return { text: 'Газ в червоточине: примерно через 15–20 минут прилетят Sleeper’ы', level: 'warn' }
    if (/nebula|туманн/i.test(n)) return { text: 'Бустерный газ (туманность)', level: 'mid' }
  }
  if (s.kind === 'combat') return { text: 'Боевой сайт: может дать эскалацию (DED)', level: 'mid' }
  return null
}

const storeKey = (system: string) => `canopus.sigs.${system}`

function loadSaved(system: string): Sig[] {
  try {
    return JSON.parse(localStorage.getItem(storeKey(system)) ?? '[]')
  } catch {
    return []
  }
}

function saveSigs(system: string, sigs: Sig[]): void {
  try {
    localStorage.setItem(storeKey(system), JSON.stringify(sigs))
  } catch {
    // storage unavailable: history just isn't kept
  }
}

interface Snapshot {
  sigs: Sig[]
  system: string
  at: number
  added: Set<string>
  gone: Sig[]
}

function Signatures() {
  const { probe, system } = useIntel()
  const [text, setText] = useState('')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [showAnomalies, setShowAnomalies] = useState(false)

  function apply(raw: string, sysName: string | null) {
    const sigs = parseSigs(raw)
    if (!sigs.length) return
    const key = sysName ?? 'unknown'
    const prev = loadSaved(key)
    const prevById = new Map(prev.map((s) => [s.id, s]))
    // A partial rescan keeps what an earlier, stronger scan already revealed.
    const merged = sigs.map((s) => {
      const p = prevById.get(s.id)
      return p && p.strength > s.strength && !s.name ? { ...s, type: p.type || s.type, name: p.name, kind: p.kind, strength: p.strength } : s
    })
    const now = new Set(merged.map((s) => s.id))
    setSnap({
      sigs: merged,
      system: key,
      at: Date.now(),
      added: new Set(prev.length ? merged.filter((s) => !prevById.has(s.id)).map((s) => s.id) : []),
      gone: prev.filter((s) => !now.has(s.id))
    })
    saveSigs(key, merged)
  }

  // New probe scanner copies from the game arrive through the clipboard watcher.
  useEffect(() => {
    if (probe) apply(probe.text, probe.system)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe?.at])

  const shown = useMemo(() => (snap?.sigs ?? []).filter((s) => showAnomalies || !s.anomaly).sort((a, b) => a.kind.localeCompare(b.kind) || b.strength - a.strength), [snap, showAnomalies])
  const counts = useMemo(() => {
    const m = new Map<SigKind, number>()
    for (const s of snap?.sigs ?? []) if (!s.anomaly) m.set(s.kind, (m.get(s.kind) ?? 0) + 1)
    return m
  }, [snap])
  const scanned = (snap?.sigs ?? []).filter((s) => !s.anomaly && s.strength >= 100).length
  const total = (snap?.sigs ?? []).filter((s) => !s.anomaly).length

  return (
    <>
      <Card>
        <p className="muted small">
          В игре: окно сканера зондов → <b>Ctrl+A</b>, <b>Ctrl+C</b>. Canopus разберёт сигнатуры автоматически, запомнит их для системы и при следующем копировании покажет новые и
          исчезнувшие. Или вставьте вручную:
        </p>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="ABC-123	Cosmic Signature	Data Site	Central Guristas Survey Site	100,0%	3,44 AU" />
        <div className="row">
          <button disabled={!text.trim()} onClick={() => apply(text, system?.name ?? null)}>
            Разобрать
          </button>
          <span className="muted small">{`Система: ${system?.name ?? 'неизвестна (нет лога Local)'}`}</span>
        </div>
      </Card>
      {!snap ? (
        <Empty>Скопируйте результаты сканера зондов в игре.</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Сигнатур" value={total} sub={`просканировано полностью: ${scanned}`} />
            <Stat label="Новых" value={<span className={snap.added.size ? 'bad' : ''}>{snap.added.size}</span>} sub="с прошлого копирования" />
            <Stat label="Исчезло" value={snap.gone.length} sub={snap.gone.map((g) => g.id).join(', ') || '—'} />
            <Stat
              label="По типам"
              value={<span className="small">{[...counts.entries()].map(([k, n]) => `${translate(KIND_LABEL[k])} ${n}`).join(' · ') || '—'}</span>}
              sub={snap.system}
            />
          </div>
          <Card
            actions={
              <label className="check small">
                <input type="checkbox" checked={showAnomalies} onChange={(e) => setShowAnomalies(e.target.checked)} />
                Показывать аномалии
              </label>
            }
          >
            <table className="table compact sig-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Тип</th>
                  <th>Название</th>
                  <th className="num">Сигнал</th>
                  <th className="num">Дистанция</th>
                  <th>Что ждать</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const h = hint(s)
                  return (
                    <tr key={s.id} className={snap.added.has(s.id) ? 'arrived' : ''}>
                      <td className="mono">
                        {s.id}
                        {snap.added.has(s.id) && <span className="new-badge">новая</span>}
                      </td>
                      <td>
                        <span className={`sig-kind sig-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                      </td>
                      <td translate="no">{s.name || <span className="muted">—</span>}</td>
                      <td className="num">
                        <div className="sig-strength">
                          <div style={{ width: `${Math.min(100, s.strength)}%` }} />
                        </div>
                        {`${s.strength.toLocaleString(locale(), { maximumFractionDigits: 1 })}%`}
                      </td>
                      <td className="num muted" translate="no">
                        {s.distance}
                      </td>
                      <td className={`small sig-hint-${h?.level ?? ''}`}>{h?.text ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  )
}

// ---------------- Ratting tracker (game log) ----------------

/** A break this long starts a new ratting session. */
const SESSION_GAP_MS = 20 * 60_000
/** Window for the "right now" DPS. */
const LIVE_WINDOW_MS = 10_000

function RattingTracker() {
  const [events, setEvents] = useState<CombatLogEvent[]>([])
  const [manualStart, setManualStart] = useState<number | null>(null)
  const now = useTick(1000)

  useEffect(() => {
    void window.api.ratting.events().then(setEvents)
    const offEvents = window.api.ratting.onEvents((e) => setEvents((prev) => [...prev, ...e]))
    const offReset = window.api.ratting.onReset(() => setEvents([]))
    return () => {
      offEvents()
      offReset()
    }
  }, [])

  const s = useMemo(() => {
    const action = events.filter((e) => e.kind !== 'system')
    // The current session: activity since the last long break (or since "new session").
    let start = action[0]?.t ?? 0
    for (let i = 1; i < action.length; i++) if (action[i].t - action[i - 1].t > SESSION_GAP_MS) start = action[i].t
    if (manualStart && manualStart > start) start = manualStart
    const ev = action.filter((e) => e.t >= start)
    const last = ev.at(-1)?.t ?? start
    const end = now - last < SESSION_GAP_MS ? Math.max(now, last) : last
    const hours = Math.max((end - start) / 3_600_000, 1 / 60)
    const bounties = ev.filter((e) => e.kind === 'bounty')
    const isk = bounties.reduce((a, e) => a + e.amount, 0)
    const out = ev.filter((e) => e.kind === 'out')
    const inc = ev.filter((e) => e.kind === 'in')
    const dealt = out.reduce((a, e) => a + e.amount, 0)
    const taken = inc.reduce((a, e) => a + e.amount, 0)
    // Seconds with shooting, to average DPS over the fighting only.
    const busySeconds = new Set(out.map((e) => Math.floor(e.t / 1000))).size
    const liveOut = out.filter((e) => now - e.t <= LIVE_WINDOW_MS).reduce((a, e) => a + e.amount, 0) / (LIVE_WINDOW_MS / 1000)
    const liveIn = inc.filter((e) => now - e.t <= LIVE_WINDOW_MS).reduce((a, e) => a + e.amount, 0) / (LIVE_WINDOW_MS / 1000)
    const top = (list: CombatLogEvent[]) => {
      const m = new Map<string, number>()
      for (const e of list) m.set(e.who, (m.get(e.who) ?? 0) + e.amount)
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    }
    // Bounties per 5 minutes for the chart.
    const bucket = 5 * 60_000
    const buckets: number[] = []
    for (const e of bounties) {
      const i = Math.floor((e.t - start) / bucket)
      buckets[i] = (buckets[i] ?? 0) + e.amount
    }
    const system = [...events].reverse().find((e) => e.kind === 'system')?.who ?? null
    return { start, end, hours, isk, kills: bounties.length, dealt, taken, busySeconds, liveOut, liveIn, targets: top(out), attackers: top(inc), buckets: Array.from(buckets, (v) => v ?? 0), system, active: now - last < 60_000 && ev.length > 0 }
  }, [events, manualStart, now])

  if (!events.length)
    return (
      <Empty>
        Боевой лог не найден. Canopus читает игровой журнал (Документы\EVE\logs\Gamelogs) активного персонажа — зайдите в игру и начните бой; статистика появится
        автоматически.
      </Empty>
    )

  const maxBucket = Math.max(1, ...s.buckets)
  return (
    <>
      <div className="stats-row">
        <Stat label="ISK в час" value={<span className="good">{fmtIsk(s.isk / s.hours, true)}</span>} sub={`награды за сессию: ${fmtIsk(s.isk, true)}`} />
        <Stat label="Убито NPC" value={fmtNum(s.kills)} sub={`сессия ${fmtDuration(s.end - s.start)}${s.system ? ` · ${s.system}` : ''}`} />
        <Stat label="Ваш DPS" value={s.active ? fmtNum(Math.round(s.liveOut)) : '—'} sub={`в среднем в бою ${fmtNum(Math.round(s.busySeconds ? s.dealt / s.busySeconds : 0))}`} />
        <Stat label="Входящий DPS" value={<span className={s.liveIn > 0 ? 'bad' : ''}>{s.active ? fmtNum(Math.round(s.liveIn)) : '—'}</span>} sub={`получено урона: ${fmtNum(s.taken)}`} />
      </div>
      <div className="row">
        <button className="ghost" onClick={() => setManualStart(Date.now())}>
          Начать новую сессию
        </button>
        {manualStart && (
          <button className="ghost" onClick={() => setManualStart(null)}>
            Сессия по логу
          </button>
        )}
        <span className="muted small">Сессия начинается после перерыва больше 20 минут. Награды — как в игре, «добавлено к следующей выплате».</span>
      </div>
      <Card title="Награды по 5 минут">
        <div className="bounty-chart">
          {s.buckets.map((v, i) => (
            <div key={i} className="bounty-bar" title={`${i * 5}–${i * 5 + 5} мин: ${fmtIsk(v, true)}`} style={{ height: `${(v / maxBucket) * 100}%` }} />
          ))}
        </div>
      </Card>
      <div className="two-col">
        <Card title="По кому идёт урон">
          <table className="table compact">
            <tbody>
              {s.targets.map(([who, dmg]) => (
                <tr key={who}>
                  <td translate="no">{who}</td>
                  <td className="num">{fmtNum(dmg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Кто бьёт по вам">
          {!s.attackers.length ? (
            <p className="muted small">Урона не получено.</p>
          ) : (
            <table className="table compact">
              <tbody>
                {s.attackers.map(([who, dmg]) => (
                  <tr key={who}>
                    <td translate="no">{who}</td>
                    <td className="num bad">{fmtNum(dmg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  )
}

// ---------------- Abyss tracker ----------------

const TIERS = ['Tranquil', 'Calm', 'Agitated', 'Fierce', 'Raging', 'Chaotic', 'Cataclysmic']
const WEATHERS = ['Electrical', 'Dark', 'Exotic', 'Firestorm', 'Gamma']
const WEATHER_LABEL: Record<string, string> = { Electrical: 'Электрическая', Dark: 'Тёмная', Exotic: 'Экзотическая', Firestorm: 'Огненная', Gamma: 'Гамма' }
const ABYSS_TIME_MS = 20 * 60_000
const RUNS_KEY = 'abyss-runs'

interface AbyssRun {
  id: string
  start: number
  end: number
  tier: number
  weather: string
  shipTypeId: number | null
  loot: number
  lootBuy: number
  filament: number
  died: boolean
}

/** Jita sell / buy value of a pasted loot list (cargo window, Ctrl+A, Ctrl+C). */
async function appraiseLoot(text: string): Promise<{ sell: number; buy: number; unknown: string[] }> {
  const items = parseItemList(text)
  const ids = await window.api.intel.resolveTypeNames(items.map((i) => i.name))
  const prices = await jitaPrices(Object.values(ids))
  let sell = 0
  let buy = 0
  const unknown: string[] = []
  for (const it of items) {
    const id = ids[it.name]
    if (!id) {
      unknown.push(it.name)
      continue
    }
    sell += (prices.get(id)?.sell.best ?? 0) * it.qty
    buy += (prices.get(id)?.buy.best ?? 0) * it.qty
  }
  return { sell, buy, unknown }
}

function AbyssTracker() {
  const lang = useLang()
  const { system } = useIntel()
  const now = useTick(1000)
  const [runs, setRuns] = useState<AbyssRun[]>([])
  const [tier, setTier] = useState(1)
  const [weather, setWeather] = useState('Firestorm')
  const [ship, setShip] = useState<number | null>(null)
  const [started, setStarted] = useState<number | null>(null)
  const [finished, setFinished] = useState<number | null>(null)
  const [lootText, setLootText] = useState('')
  const [loot, setLoot] = useState<{ sell: number; buy: number; unknown: string[] } | null>(null)
  const [died, setDied] = useState(false)
  const [auto, setAuto] = useState(true)
  const shipName = useTypeBasic(ship ?? 0)

  useEffect(() => {
    void window.api.store.get<AbyssRun[]>(RUNS_KEY).then((r) => setRuns(r ?? []))
  }, [])
  const saveRuns = (next: AbyssRun[]) => {
    setRuns(next)
    void window.api.store.set(RUNS_KEY, next)
  }

  // Entering an abyssal pocket ("AD123") starts the timer, leaving it stops the run.
  const inAbyss = /^AD\d{3}$/.test(system?.name ?? '')
  useEffect(() => {
    if (!auto) return
    if (inAbyss && !started) {
      setStarted(Date.now())
      setFinished(null)
    } else if (!inAbyss && started && !finished) setFinished(Date.now())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inAbyss, auto])

  const filament = useAsync(async () => {
    const name = `${TIERS[tier]} ${weather} Filament`
    const ids = await window.api.intel.resolveTypeNames([name])
    const id = ids[name]
    if (!id) return { id: null, price: 0 }
    const p = await jitaPrices([id])
    return { id, price: p.get(id)?.sell.best ?? 0 }
  }, [tier, weather])

  const elapsed = started ? (finished ?? now) - started : 0
  const left = ABYSS_TIME_MS - elapsed

  function save() {
    if (!started) return
    const run: AbyssRun = {
      id: String(started),
      start: started,
      end: finished ?? Date.now(),
      tier,
      weather,
      shipTypeId: ship,
      loot: died ? 0 : (loot?.sell ?? 0),
      lootBuy: died ? 0 : (loot?.buy ?? 0),
      filament: filament.data?.price ?? 0,
      died
    }
    saveRuns([run, ...runs])
    setStarted(null)
    setFinished(null)
    setLoot(null)
    setLootText('')
    setDied(false)
  }

  const stats = useMemo(() => {
    const group = (key: (r: AbyssRun) => string) => {
      const m = new Map<string, AbyssRun[]>()
      for (const r of runs) m.set(key(r), [...(m.get(key(r)) ?? []), r])
      return [...m.entries()].map(([k, list]) => {
        const time = list.reduce((a, r) => a + (r.end - r.start), 0)
        const net = list.reduce((a, r) => a + r.loot - r.filament, 0)
        return { k, runs: list.length, deaths: list.filter((r) => r.died).length, avgLoot: list.reduce((a, r) => a + r.loot, 0) / list.length, avgMin: time / list.length / 60_000, iskHour: time ? net / (time / 3_600_000) : 0 }
      })
    }
    return { byTier: group((r) => `T${r.tier} ${TIERS[r.tier]}`).sort((a, b) => a.k.localeCompare(b.k)), byShip: group((r) => String(r.shipTypeId ?? 0)) }
  }, [runs])

  return (
    <>
      <Card title="Текущий забег">
        <div className="abyss-run">
          <div className={`abyss-timer ${started && left < 0 ? 'bad' : started && left < 3 * 60_000 ? 'warn-text' : ''}`}>
            {started ? `${left < 0 ? '−' : ''}${fmtClock(Math.abs(left))}` : '20:00'}
            <div className="muted small">{started ? (finished ? 'забег окончен' : left < 0 ? 'время вышло!' : 'осталось') : inAbyss ? 'вы в бездне' : 'ожидание'}</div>
          </div>
          <div className="abyss-form">
            <label>
              Уровень
              <select value={tier} onChange={(e) => setTier(Number(e.target.value))}>
                {TIERS.map((t, i) => (
                  <option key={t} value={i}>
                    {`T${i} ${t}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Погода
              <select value={weather} onChange={(e) => setWeather(e.target.value)}>
                {WEATHERS.map((w) => (
                  <option key={w} value={w}>
                    {WEATHER_LABEL[w]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Корабль
              <SearchBox
                placeholder={ship ? tn(shipName?.n, lang) : 'Корабль…'}
                search={(q) => searchTypesSde(q, lang, { categories: [CATEGORY.SHIP] })}
                onSelect={(t) => setShip(t.id)}
                clearOnSelect
              />
            </label>
            <div className="muted small">
              {filament.data?.id ? `Филамент ${TIERS[tier]} ${weather}: ${fmtIsk(filament.data.price, true)} (Jita)` : ''}
            </div>
            <label className="check small">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Запускать таймер автоматически (по логу Local: системы AD###)
            </label>
          </div>
          <div className="abyss-actions">
            {!started ? (
              <button onClick={() => (setStarted(Date.now()), setFinished(null))}>Старт</button>
            ) : !finished ? (
              <button onClick={() => setFinished(Date.now())}>Завершить</button>
            ) : null}
            {started && (
              <button className="ghost" onClick={() => (setStarted(null), setFinished(null))}>
                Отменить
              </button>
            )}
          </div>
        </div>
        {finished && (
          <div className="abyss-finish">
            <p className="muted small">Вставьте лут: окно грузового отсека → Ctrl+A, Ctrl+C.</p>
            <textarea rows={4} value={lootText} onChange={(e) => setLootText(e.target.value)} />
            <div className="row">
              <button className="ghost" disabled={!lootText.trim()} onClick={async () => setLoot(await appraiseLoot(lootText))}>
                Оценить лут
              </button>
              <label className="check">
                <input type="checkbox" checked={died} onChange={(e) => setDied(e.target.checked)} />
                Корабль погиб
              </label>
              {loot && <span>{`Лут: ${fmtIsk(loot.sell, true)} (продажа) · ${fmtIsk(loot.buy, true)} (скупка)`}</span>}
              <button onClick={save}>Сохранить забег</button>
            </div>
            {loot?.unknown.length ? <div className="warn">{`Не распознано: ${loot.unknown.join(', ')}`}</div> : null}
          </div>
        )}
      </Card>

      {runs.length > 0 && (
        <>
          <div className="two-col">
            <Card title="По уровням">
              <AbyssStats rows={stats.byTier} label={(k) => k} />
            </Card>
            <Card title="По кораблям">
              <AbyssStats rows={stats.byShip} label={(k) => (Number(k) ? <TypeLink id={Number(k)} size={20} /> : '—')} />
            </Card>
          </div>
          <Card title={`Забеги (${runs.length})`}>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Уровень</th>
                  <th>Погода</th>
                  <th>Корабль</th>
                  <th className="num">Время</th>
                  <th className="num">Лут</th>
                  <th className="num">Филамент</th>
                  <th className="num">Итог</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className={r.died ? 'danger' : ''}>
                    <td className="muted small">{fmtDate(new Date(r.start).toISOString())}</td>
                    <td>{`T${r.tier}`}</td>
                    <td>{WEATHER_LABEL[r.weather] ?? r.weather}</td>
                    <td>{r.shipTypeId ? <TypeLink id={r.shipTypeId} size={16} /> : '—'}</td>
                    <td className="num">{fmtClock(r.end - r.start)}</td>
                    <td className="num">{r.died ? <span className="bad">погиб</span> : fmtIsk(r.loot, true)}</td>
                    <td className="num muted">{fmtIsk(r.filament, true)}</td>
                    <td className={`num ${r.loot - r.filament >= 0 ? 'good' : 'bad'}`}>{fmtIsk(r.loot - r.filament, true)}</td>
                    <td>
                      <button className="ghost small danger" onClick={() => saveRuns(runs.filter((x) => x.id !== r.id))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  )
}

function AbyssStats({ rows, label }: { rows: { k: string; runs: number; deaths: number; avgLoot: number; avgMin: number; iskHour: number }[]; label: (k: string) => ReactNode }) {
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th />
          <th className="num">Забегов</th>
          <th className="num">Смертей</th>
          <th className="num">Средний лут</th>
          <th className="num">Среднее время</th>
          <th className="num">ISK / час</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.k}>
            <td>{label(r.k)}</td>
            <td className="num">{r.runs}</td>
            <td className={`num ${r.deaths ? 'bad' : ''}`}>{r.deaths}</td>
            <td className="num">{fmtIsk(r.avgLoot, true)}</td>
            <td className="num">{`${r.avgMin.toFixed(1)} мин`}</td>
            <td className="num">
              <b>{fmtIsk(r.iskHour, true)}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
