import { useEffect, useMemo, useState } from 'react'
import { useIntel } from '../IntelContext'
import { Card, Empty, Stat, Tabs } from '../components/ui'
import { locale } from '../i18n'
import type { CombatLogEvent } from '../../../shared/ratting'
import { fmtDuration, fmtIsk, fmtNum } from '../lib/format'
import { useTick } from '../lib/useAsync'

type Tab = 'sigs' | 'ratting'

export default function ActivitiesPage() {
  const [tab, setTab] = useState<Tab>('sigs')
  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'sigs', label: 'Сигнатуры' },
          { id: 'ratting', label: 'Крабинг' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'sigs' && <Signatures />}
      {tab === 'ratting' && <RattingTracker />}
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
              value={<span className="small">{[...counts.entries()].map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(' · ') || '—'}</span>}
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
