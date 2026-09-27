import { Fragment, useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { Card, Empty, ErrorBox, Loading, SearchBox, Sec, Stat, Tabs } from '../components/ui'
import { esi, systemInfo, systemRegion } from '../lib/esi'
import { routeDanger, type SystemDanger } from '../lib/routeSafety'
import Wormholes from './Wormholes'
import { TypeLink } from '../components/TypeLink'
import { searchSystemsSde } from '../lib/sde'
import { fmtIsk, fmtNum, roundSec } from '../lib/format'
import { useAsync } from '../lib/useAsync'

type Tab = 'route' | 'thera' | 'wormholes'
type Flag = 'shortest' | 'secure' | 'insecure'
interface Sys {
  id: number
  name: string
}

export default function MapPage() {
  const [tab, setTab] = useState<Tab>('route')
  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'route', label: 'Маршрут' },
          { id: 'thera', label: 'Thera / Turnur' },
          { id: 'wormholes', label: 'Вормхолы' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'route' && <RoutePlanner />}
      {tab === 'thera' && <WormholeConnections />}
      {tab === 'wormholes' && <Wormholes />}
    </div>
  )
}

/** The logged-in character's current system, if location scope is granted. */
function useCurrentSystem(): Sys | null {
  const { active } = useApp()
  const [sys, setSys] = useState<Sys | null>(null)
  useEffect(() => {
    if (!active) return
    esi<{ solar_system_id: number }>(`/characters/${active.id}/location/`, { characterId: active.id })
      .then((l) => systemInfo(l.solar_system_id))
      .then((s) => setSys({ id: s.system_id, name: s.name }))
      .catch(() => {})
  }, [active?.id])
  return sys
}

async function activityMaps(): Promise<{ kills: Map<number, { ship: number; pod: number; npc: number }>; jumps: Map<number, number> }> {
  const [k, j] = await Promise.all([
    esi<{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }[]>('/universe/system_kills/'),
    esi<{ system_id: number; ship_jumps: number }[]>('/universe/system_jumps/')
  ])
  return {
    kills: new Map(k.map((r) => [r.system_id, { ship: r.ship_kills, pod: r.pod_kills, npc: r.npc_kills }])),
    jumps: new Map(j.map((r) => [r.system_id, r.ship_jumps]))
  }
}

// ---------------- Route planner ----------------

function RoutePlanner() {
  const { active } = useApp()
  const current = useCurrentSystem()
  const [origin, setOrigin] = useState<Sys | null>(null)
  const [dest, setDest] = useState<Sys | null>(null)
  const [flag, setFlag] = useState<Flag>('secure')
  const [waypointMsg, setWaypointMsg] = useState<string | null>(null)
  const [danger, setDanger] = useState<Map<number, SystemDanger>>(new Map())
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    if (current && !origin) setOrigin(current)
  }, [current, origin])

  const search = searchSystemsSde

  const route = useAsync(async () => {
    if (!origin || !dest) return null
    const ids = await esi<number[]>(`/route/${origin.id}/${dest.id}/?flag=${flag}`)
    const [systems, activity] = await Promise.all([Promise.all(ids.map((id) => systemInfo(id))), activityMaps()])
    const regions = await Promise.all(ids.map((id) => systemRegion(id).catch(() => '')))
    return systems.map((s, i) => ({
      ...s,
      region: regions[i],
      kills: activity.kills.get(s.system_id),
      jumps: activity.jumps.get(s.system_id) ?? 0
    }))
  }, [origin?.id, dest?.id, flag])

  async function setWaypoint() {
    if (!active || !dest) return
    setWaypointMsg(null)
    try {
      await esi(`/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=true&destination_id=${dest.id}`, {
        method: 'POST',
        characterId: active.id
      })
      setWaypointMsg('Маршрут установлен в клиенте игры')
    } catch (e) {
      setWaypointMsg((e as Error).message)
    }
  }

  const rows = route.data ?? []

  // Recent kills from zKillboard for systems where ESI saw ship kills in the last hour.
  const routeKey = rows.map((r) => r.system_id).join(',')
  useEffect(() => {
    setDanger(new Map())
    setOpen(null)
    const hot = rows.filter((r) => (r.kills?.ship ?? 0) + (r.kills?.pod ?? 0) > 0).map((r) => r.system_id)
    if (!hot.length) {
      setChecking(null)
      return
    }
    let cancelled = false
    let done = 0
    setChecking({ done: 0, total: hot.length })
    void routeDanger(
      hot,
      (d) => {
        done++
        setDanger((m) => new Map(m).set(d.systemId, d))
        setChecking({ done, total: hot.length })
      },
      () => cancelled
    ).then(() => !cancelled && setChecking(null))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey])

  /** A camp on a gate this route actually uses (to the previous or next system). */
  const onPath = (i: number, to: number) => rows[i - 1]?.system_id === to || rows[i + 1]?.system_id === to
  const pathCamps = rows.flatMap((r, i) => (danger.get(r.system_id)?.camps ?? []).filter((c) => onPath(i, c.to)).map((c) => ({ sys: r, camp: c })))
  const counts = {
    high: rows.filter((s) => roundSec(s.security_status) >= 0.5).length,
    low: rows.filter((s) => roundSec(s.security_status) > 0 && roundSec(s.security_status) < 0.5).length,
    null: rows.filter((s) => roundSec(s.security_status) <= 0).length,
    kills: rows.reduce((a, s) => a + (s.kills?.ship ?? 0) + (s.kills?.pod ?? 0), 0)
  }

  return (
    <>
      <Card>
        <div className="route-form">
          <label>
            Откуда
            <SearchBox placeholder="Система…" search={search} onSelect={setOrigin} initial={origin?.name ?? ''} />
          </label>
          <label>
            Куда
            <SearchBox placeholder="Система…" search={search} onSelect={setDest} initial={dest?.name ?? ''} />
          </label>
          <label>
            Тип маршрута
            <select value={flag} onChange={(e) => setFlag(e.target.value as Flag)}>
              <option value="secure">Безопасный</option>
              <option value="shortest">Кратчайший</option>
              <option value="insecure">Через low/null</option>
            </select>
          </label>
          <div className="route-actions">
            {current && (
              <button className="ghost" onClick={() => setOrigin(current)}>
                Я здесь: {current.name}
              </button>
            )}
            {active && dest && <button onClick={setWaypoint}>Проложить в игре</button>}
          </div>
        </div>
        {waypointMsg && <div className="muted">{waypointMsg}</div>}
      </Card>

      {!origin || !dest ? (
        <Empty>Выберите начальную и конечную систему. Если вы вошли, начальная система — ваша текущая.</Empty>
      ) : route.loading ? (
        <Loading label="Строю маршрут…" />
      ) : route.error ? (
        <ErrorBox error={route.error} />
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Прыжков" value={rows.length - 1} />
            <Stat label="Highsec / Lowsec / Null" value={`${counts.high} / ${counts.low} / ${counts.null}`} />
            <Stat label="Убийств за час на маршруте" value={counts.kills} sub="корабли + капсулы" />
            <Stat
              label="Кемпов на вашем пути"
              value={<span className={pathCamps.length ? 'bad' : 'good'}>{pathCamps.length}</span>}
              sub={checking ? `проверяю zKillboard: ${checking.done} из ${checking.total}` : 'по свежим убийствам на воротах'}
            />
          </div>
          {pathCamps.length > 0 && (
            <div className="warn-box">
              {pathCamps.map(({ sys, camp }) => (
                <div key={`${sys.system_id}-${camp.gate}`}>
                  {'⚠ '}
                  <b>{sys.name}</b>
                  {`: кемп на воротах в `}
                  <SystemName id={camp.to} />
                  {` — убийств: ${camp.kills}, последнее ${Math.round(camp.lastAgo / 60_000)} мин назад`}
                </div>
              ))}
            </div>
          )}
          <Card>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Система</th>
                  <th>Регион</th>
                  <th className="num">Корабли / капсулы (1ч)</th>
                  <th className="num">NPC (1ч)</th>
                  <th className="num">Прыжков (1ч)</th>
                  <th>Обстановка (zKillboard, 1ч)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => {
                  const killsHour = (s.kills?.ship ?? 0) + (s.kills?.pod ?? 0)
                  const d = danger.get(s.system_id)
                  const campHere = d?.camps.some((c) => onPath(i, c.to))
                  return (
                    <Fragment key={s.system_id}>
                    <tr className={`${campHere || killsHour >= 5 ? 'danger' : ''} ${d?.kills.length ? 'clickable' : ''}`} onClick={() => d?.kills.length && setOpen(open === s.system_id ? null : s.system_id)}>
                      <td className="muted">{i}</td>
                      <td>
                        <Sec value={s.security_status} /> {s.name}
                      </td>
                      <td className="muted">{s.region}</td>
                      <td className={`num ${killsHour ? 'bad' : ''}`}>
                        {s.kills?.ship ?? 0} / {s.kills?.pod ?? 0}
                      </td>
                      <td className="num">{fmtNum(s.kills?.npc ?? 0)}</td>
                      <td className="num">{fmtNum(s.jumps)}</td>
                      <td>{d ? <DangerBadges d={d} onPath={(to) => onPath(i, to)} /> : killsHour && checking ? <span className="muted small">…</span> : null}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <a href={`https://zkillboard.com/system/${s.system_id}/`} target="_blank" rel="noreferrer">
                          zKill
                        </a>{' '}
                        <a href={`https://evemaps.dotlan.net/system/${s.name.replace(/ /g, '_')}`} target="_blank" rel="noreferrer">
                          Dotlan
                        </a>
                      </td>
                    </tr>
                    {open === s.system_id && d && (
                      <tr className="sub-row">
                        <td colSpan={8}>
                          <KillList d={d} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
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

function SystemName({ id }: { id: number }) {
  const info = useAsync(() => systemInfo(id), [id])
  return <b>{info.data?.name ?? '…'}</b>
}

const minAgo = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))} мин назад`

function DangerBadges({ d, onPath }: { d: SystemDanger; onPath: (to: number) => boolean }) {
  if (!d.kills.length) return <span className="muted small">спокойно</span>
  return (
    <span className="danger-badges">
      {d.camps.map((c) => (
        <span key={c.gate} className={`threat ${onPath(c.to) ? 'threat-hostile' : 'threat-high'}`}>
          {'кемп у ворот в '}
          <SystemName id={c.to} />
        </span>
      ))}
      {d.bubbles && <span className="threat threat-high">бабблы</span>}
      {d.smartbombs && <span className="threat threat-high">смартбомбы</span>}
      <span className="muted small">{`убийств: ${d.kills.length} · последнее ${minAgo(Date.now() - d.kills[0].time)}`}</span>
    </span>
  )
}

function KillList({ d }: { d: SystemDanger }) {
  return (
    <table className="table compact">
      <tbody>
        {d.kills.map((k) => (
          <tr key={k.id}>
            <td className="muted small nowrap">{minAgo(Date.now() - k.time)}</td>
            <td>
              <TypeLink id={k.victimShip} size={20} />
            </td>
            <td className="small">{k.gate ? <>{'у ворот в '}<SystemName id={k.gate.to} /></> : <span className="muted">не у ворот</span>}</td>
            <td className="num small">{`нападавших: ${k.attackers}`}</td>
            <td className="num small">{fmtIsk(k.value, true)}</td>
            <td className="small">
              {k.bubbles && <span className="threat threat-high">баббл</span>} {k.smartbombs && <span className="threat threat-high">смартбомбы</span>}
            </td>
            <td>
              <a href={`https://zkillboard.com/kill/${k.id}/`} target="_blank" rel="noreferrer">
                zKill
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------- Thera / Turnur (EVE-Scout) ----------------

interface Signature {
  id: string
  out_system_id: number
  out_system_name: string
  out_signature: string
  in_system_id: number
  in_system_name: string
  in_system_class: string
  in_region_name: string
  in_signature: string
  max_ship_size: string
  remaining_hours: number
  wh_type: string
  signature_type: string
  completed: boolean
}

const SHIP_SIZE: Record<string, string> = {
  small: 'Малые (фрегаты, эсминцы)',
  medium: 'Средние (до крейсеров)',
  large: 'Большие (до линкоров)',
  xlarge: 'Фрейтеры',
  capital: 'Капиталы'
}

const CLASS_LABEL: Record<string, string> = { hs: 'Highsec', ls: 'Lowsec', ns: 'Nullsec', pochven: 'Pochven' }

function WormholeConnections() {
  const { active } = useApp()
  const current = useCurrentSystem()
  const [hub, setHub] = useState<'all' | 'Thera' | 'Turnur'>('all')
  const [kspaceOnly, setKspaceOnly] = useState(true)
  const [origin, setOrigin] = useState<Sys | null>(null)
  const [jumps, setJumps] = useState<Map<number, number | null>>(new Map())
  const [counting, setCounting] = useState(false)

  useEffect(() => {
    if (current && !origin) setOrigin(current)
  }, [current, origin])

  const { data, error, loading, reload } = useAsync(
    () => window.api.request<Signature[]>('https://api.eve-scout.com/v2/public/signatures'),
    []
  )

  const list = (data ?? [])
    .filter((s) => s.signature_type === 'wormhole')
    .filter((s) => hub === 'all' || s.out_system_name === hub)
    .filter((s) => !kspaceOnly || !/^c\d+$/i.test(s.in_system_class))
    .sort((a, b) => (jumps.get(a.in_system_id) ?? 999) - (jumps.get(b.in_system_id) ?? 999) || b.remaining_hours - a.remaining_hours)

  async function countJumps() {
    if (!origin) return
    setCounting(true)
    const targets = [...new Set(list.filter((s) => !/^c\d+$/i.test(s.in_system_class)).map((s) => s.in_system_id))]
    const result = new Map<number, number | null>()
    const queue = [...targets]
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          try {
            const route = await esi<number[]>(`/route/${origin.id}/${id}/?flag=shortest`)
            result.set(id, route.length - 1)
          } catch {
            result.set(id, null)
          }
        }
      })
    )
    setJumps(result)
    setCounting(false)
  }

  return (
    <>
      <Card>
        <div className="route-form">
          <label>
            Хаб
            <select value={hub} onChange={(e) => setHub(e.target.value as typeof hub)}>
              <option value="all">Thera и Turnur</option>
              <option value="Thera">Thera</option>
              <option value="Turnur">Turnur</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={kspaceOnly} onChange={(e) => setKspaceOnly(e.target.checked)} /> Только k-space
          </label>
          <label>
            Считать прыжки от
            <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setOrigin} initial={origin?.name ?? ''} />
          </label>
          <div className="route-actions">
            <button onClick={countJumps} disabled={!origin || counting}>
              {counting ? 'Считаю…' : 'Посчитать прыжки'}
            </button>
            <button className="ghost" onClick={reload}>
              Обновить
            </button>
          </div>
        </div>
        <p className="muted small">Данные предоставлены EVE-Scout (eve-scout.com). Прыжки — кратчайший путь по ESI до системы входа.</p>
      </Card>

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <Card>
          <table className="table">
            <thead>
              <tr>
                <th>Хаб</th>
                <th>Сигнатура в хабе</th>
                <th>Выход</th>
                <th>Регион</th>
                <th>Сигнатура выхода</th>
                <th>Корабли</th>
                <th className="num">Осталось</th>
                <th className="num">Прыжков</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{s.out_system_name}</td>
                  <td className="mono">{s.out_signature}</td>
                  <td>
                    {s.in_system_name} <span className="muted">({CLASS_LABEL[s.in_system_class] ?? s.in_system_class.toUpperCase()})</span>
                  </td>
                  <td className="muted">{s.in_region_name}</td>
                  <td className="mono">{s.in_signature}</td>
                  <td className="muted">{SHIP_SIZE[s.max_ship_size] ?? s.max_ship_size}</td>
                  <td className={`num ${s.remaining_hours <= 2 ? 'bad' : ''}`}>{s.remaining_hours} ч</td>
                  <td className="num">{jumps.has(s.in_system_id) ? jumps.get(s.in_system_id) ?? '—' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <Empty>Нет подходящих соединений.</Empty>}
        </Card>
      )}
    </>
  )
}
