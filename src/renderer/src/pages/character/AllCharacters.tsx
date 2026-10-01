// Every logged-in character on one screen: where they are and in what, the skill queue, ISK,
// industry, PI, jump fatigue and the clone jump timer. For alts and multiboxing.

import { useEffect, useState } from 'react'
import { useApp } from '../../AppContext'
import type { CharacterAuth } from '../../../../shared/types'
import { TypeLink } from '../../components/TypeLink'
import { Card, Sec } from '../../components/ui'
import { esi, imageUrl, systemInfo } from '../../lib/esi'
import { fmtDuration, fmtIsk } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'

const REFRESH_MS = 5 * 60_000
const INFOMORPH_SYNCHRONIZING = 33399

interface Row {
  id: number
  name: string
  online?: boolean
  system?: { id: number; name: string; sec: number }
  docked?: boolean
  ship?: { type: number; name: string }
  /** Skill queue: end of the last skill, or null when the queue is empty */
  queueEnd?: number | null
  wallet?: number
  jobs?: { active: number; ready: number }
  /** Earliest extractor expiry; past = stopped */
  pi?: { planets: number; earliest: number | null }
  fatigueEnd?: number | null
  cloneReady?: number | null
}

/** Each part may fail on its own (a missing scope): the rest of the row still shows. */
const opt = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined)

async function loadRow(c: CharacterAuth): Promise<Row> {
  const id = c.id
  const get = <T,>(path: string) => opt(esi<T>(path, { characterId: id }))
  const [online, location, ship, queue, wallet, jobs, planets, fatigue, clones, skills] = await Promise.all([
    get<{ online: boolean }>(`/characters/${id}/online/`),
    get<{ solar_system_id: number; station_id?: number; structure_id?: number }>(`/characters/${id}/location/`),
    get<{ ship_type_id: number; ship_name: string }>(`/characters/${id}/ship/`),
    get<{ finish_date?: string }[]>(`/characters/${id}/skillqueue/`),
    get<number>(`/characters/${id}/wallet/`),
    get<{ status: string; end_date: string }[]>(`/characters/${id}/industry/jobs/`),
    get<{ planet_id: number }[]>(`/characters/${id}/planets/`),
    get<{ jump_fatigue_expire_date?: string }>(`/characters/${id}/fatigue/`),
    get<{ last_clone_jump_date?: string }>(`/characters/${id}/clones/`),
    get<{ skills: { skill_id: number; active_skill_level: number }[] }>(`/characters/${id}/skills/`)
  ])
  const sys = location ? await opt(systemInfo(location.solar_system_id)) : undefined
  const now = Date.now()
  // PI: the earliest extractor expiry over all planets.
  let pi: Row['pi']
  if (planets) {
    const details = await Promise.all(
      planets.map((p) => get<{ pins: { expiry_time?: string; extractor_details?: unknown }[] }>(`/characters/${id}/planets/${p.planet_id}/`))
    )
    const ends = details.flatMap((d) => d?.pins.filter((pin) => pin.extractor_details && pin.expiry_time).map((pin) => Date.parse(pin.expiry_time!)) ?? [])
    pi = { planets: planets.length, earliest: ends.length ? Math.min(...ends) : null }
  }
  const sync = skills?.skills.find((s) => s.skill_id === INFOMORPH_SYNCHRONIZING)?.active_skill_level ?? 0
  const queueEnds = queue?.map((q) => (q.finish_date ? Date.parse(q.finish_date) : 0)).filter((t) => t > now)
  return {
    id,
    name: c.name,
    online: online?.online,
    system: sys ? { id: sys.system_id, name: sys.name, sec: sys.security_status } : undefined,
    docked: location ? !!(location.station_id || location.structure_id) : undefined,
    ship: ship ? { type: ship.ship_type_id, name: ship.ship_name } : undefined,
    queueEnd: queue ? (queueEnds?.length ? Math.max(...queueEnds) : null) : undefined,
    wallet,
    jobs: jobs
      ? { active: jobs.filter((j) => j.status === 'active').length, ready: jobs.filter((j) => j.status === 'active' && Date.parse(j.end_date) <= now).length }
      : undefined,
    pi,
    fatigueEnd: fatigue ? (fatigue.jump_fatigue_expire_date ? Date.parse(fatigue.jump_fatigue_expire_date) : null) : undefined,
    cloneReady: clones ? (clones.last_clone_jump_date ? Date.parse(clones.last_clone_jump_date) + (24 - sync) * 3_600_000 : null) : undefined
  }
}

/** "in 3 d 4 h", "now" or "—" for a moment in the future. */
function until(t: number | null | undefined, now: number) {
  if (t === undefined) return <span className="muted">—</span>
  if (t === null || t <= now) return null
  return <>{fmtDuration(t - now)}</>
}

export default function AllCharacters({ onOpen }: { onOpen: (id: number) => void }) {
  const { characters } = useApp()
  const rows = useAsync(() => Promise.all(characters.map(loadRow)), [characters.map((c) => c.id).join(',')])
  const reload = rows.reload
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS)
    return () => clearInterval(t)
  }, [reload])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const list = rows.data ?? []
  const totalIsk = list.reduce((a, r) => a + (r.wallet ?? 0), 0)
  return (
    <Card
      title={`Все персонажи: ${characters.length}`}
      actions={
        <button className="ghost" disabled={rows.loading} onClick={reload}>
          {rows.loading ? 'Обновляю…' : 'Обновить'}
        </button>
      }
    >
      <div className="all-chars">
        <table className="table">
          <thead>
            <tr>
              <th>Персонаж</th>
              <th>Где</th>
              <th>Корабль</th>
              <th>Очередь навыков</th>
              <th className="num">ISK</th>
              <th>Индустрия</th>
              <th>Планетарка</th>
              <th>Усталость</th>
              <th>Прыжок клона</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>
                  <button className="gx-link all-chars-name" onClick={() => onOpen(r.id)} title="Открыть персонажа">
                    <img src={imageUrl.portrait(r.id, 32)} width={24} height={24} alt="" />
                    <i className={`online-dot ${r.online ? 'on' : ''}`} title={r.online === undefined ? '' : r.online ? 'В игре' : 'Не в игре'} />
                    <span translate="no">{r.name}</span>
                  </button>
                </td>
                <td>
                  {r.system ? (
                    <>
                      <Sec value={r.system.sec} /> <span translate="no">{r.system.name}</span>
                      {r.docked && <span className="muted small"> · в доке</span>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{r.ship ? <TypeLink id={r.ship.type} /> : <span className="muted">—</span>}</td>
                <td>{r.queueEnd === null ? <span className="bad">Пусто</span> : until(r.queueEnd, now)}</td>
                <td className="num">{r.wallet === undefined ? <span className="muted">—</span> : fmtIsk(r.wallet)}</td>
                <td>
                  {!r.jobs ? (
                    <span className="muted">—</span>
                  ) : r.jobs.ready ? (
                    <span className="good">{`Готово: ${r.jobs.ready}`}</span>
                  ) : r.jobs.active ? (
                    `${r.jobs.active} в работе`
                  ) : (
                    <span className="muted">нет работ</span>
                  )}
                </td>
                <td>
                  {!r.pi ? (
                    <span className="muted">—</span>
                  ) : !r.pi.planets ? (
                    <span className="muted">нет колоний</span>
                  ) : r.pi.earliest === null ? (
                    <span className="muted">без экстракторов</span>
                  ) : r.pi.earliest <= now ? (
                    <span className="bad">Экстрактор стоит</span>
                  ) : (
                    until(r.pi.earliest, now)
                  )}
                </td>
                <td>{r.fatigueEnd === null || (r.fatigueEnd !== undefined && r.fatigueEnd <= now) ? <span className="muted">нет</span> : until(r.fatigueEnd, now)}</td>
                <td>{r.cloneReady === null || (r.cloneReady !== undefined && r.cloneReady <= now) ? <span className="good">Доступен</span> : until(r.cloneReady, now)}</td>
              </tr>
            ))}
          </tbody>
          {list.length > 1 && (
            <tfoot>
              <tr>
                <td colSpan={4} className="muted">
                  Всего
                </td>
                <td className="num">{fmtIsk(totalIsk)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.error && <p className="bad small">{rows.error}</p>}
      <p className="muted small">«—» — нет данных: персонажу не хватает разрешения ESI. Войдите им заново в «Настройках». Обновляется каждые 5 минут.</p>
    </Card>
  )
}
