import { Fragment, useEffect, useState } from 'react'
import { FitView, type FitItem } from '../components/FitView'
import { useApp } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, SearchBox, Sec, Stat } from '../components/ui'
import { esi, imageUrl, resolveIds, resolveNames, systemInfo, type SystemInfo } from '../lib/esi'
import { fmtAgo, fmtIsk, fmtNum } from '../lib/format'
import { useAsync } from '../lib/useAsync'

interface Pilot {
  id: number
  name: string
}

interface ZkbStats {
  shipsDestroyed?: number
  shipsLost?: number
  iskDestroyed?: number
  iskLost?: number
  soloKills?: number
  soloLosses?: number
  dangerRatio?: number
  gangRatio?: number
  avgGangSize?: number
  info?: { corporation_id?: number; alliance_id?: number; name?: string }
}

interface Killmail {
  killmail_id: number
  killmail_time: string
  solar_system_id: number
  victim: {
    character_id?: number
    corporation_id?: number
    alliance_id?: number
    ship_type_id: number
    damage_taken?: number
    items?: { flag: number; item_type_id: number; quantity_dropped?: number; quantity_destroyed?: number }[]
  }
  attackers: { character_id?: number; corporation_id?: number; final_blow: boolean; ship_type_id?: number; weapon_type_id?: number; damage_done?: number }[]
  zkb: { hash: string; totalValue: number; solo: boolean; npc: boolean; awox: boolean }
}

async function searchPilots(q: string, characterId: number | null): Promise<Pilot[]> {
  const query = q.trim()
  if (query.length < 3) return []
  if (characterId) {
    try {
      const res = await esi<{ character?: number[] }>(
        `/characters/${characterId}/search/?categories=character&strict=false&search=${encodeURIComponent(query)}`,
        { characterId }
      )
      const ids = (res.character ?? []).slice(0, 50)
      const names = await resolveNames(ids)
      return ids
        .filter((id) => names.has(id))
        .map((id) => ({ id, name: names.get(id)! }))
        .sort((a, b) => a.name.length - b.name.length)
        .slice(0, 20)
    } catch {
      // Fall through to exact lookup.
    }
  }
  return (await resolveIds([query])).characters ?? []
}

export default function PvpPage() {
  const { active } = useApp()
  const [pilot, setPilot] = useState<Pilot | null>(null)

  useEffect(() => {
    if (active && !pilot) setPilot({ id: active.id, name: active.name })
  }, [active, pilot])

  return (
    <div className="page">
      <div className="toolbar">
        <SearchBox
          placeholder="Имя пилота…"
          search={(q) => searchPilots(q, active?.id ?? null)}
          onSelect={setPilot}
          initial={pilot?.name ?? ''}
          renderItem={(p) => (
            <>
              <img src={imageUrl.portrait(p.id, 32)} width={20} height={20} alt="" /> {p.name}
            </>
          )}
        />
        {active && pilot?.id !== active.id && (
          <button className="ghost" onClick={() => setPilot({ id: active.id, name: active.name })}>
            Мой персонаж
          </button>
        )}
      </div>
      {pilot ? <PilotBoard pilot={pilot} /> : <Empty>Найдите пилота, чтобы посмотреть его статистику и последние бои.</Empty>}
    </div>
  )
}

function KillDetails({ k, names }: { k: Killmail; names: Map<number, string> }) {
  const items: FitItem[] = (k.victim.items ?? []).map((i) => ({
    typeId: i.item_type_id,
    flag: i.flag,
    qty: (i.quantity_dropped ?? 0) + (i.quantity_destroyed ?? 0)
  }))
  const attackers = [...k.attackers].sort((a, b) => (b.damage_done ?? 0) - (a.damage_done ?? 0))
  return (
    <div className="two-col">
      <FitView shipTypeId={k.victim.ship_type_id} name={names.get(k.victim.character_id ?? 0) ?? 'Жертва'} items={items} showSkills={false} />
      <div>
        <h4>
          Атакующие ({attackers.length}) · урон {fmtNum(k.victim.damage_taken ?? 0)}
        </h4>
        <table className="table compact">
          <tbody>
            {attackers.slice(0, 30).map((a, i) => (
              <tr key={i}>
                <td>
                  {a.final_blow && <span className="badge kill" title="Последний удар">FB</span>} {a.character_id ? names.get(a.character_id) ?? a.character_id : <span className="muted">NPC</span>}
                </td>
                <td>{a.ship_type_id ? <TypeLink id={a.ship_type_id} /> : null}</td>
                <td>{a.weapon_type_id && a.weapon_type_id !== a.ship_type_id ? <TypeLink id={a.weapon_type_id} /> : null}</td>
                <td className="num">{fmtNum(a.damage_done ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a href={`https://zkillboard.com/kill/${k.killmail_id}/`} target="_blank" rel="noreferrer">
          Открыть на zKillboard
        </a>
      </div>
    </div>
  )
}

function PilotBoard({ pilot }: { pilot: Pilot }) {
  const [open, setOpen] = useState<number | null>(null)
  const { data, error, loading } = useAsync(async () => {
    const [stats, kills] = await Promise.all([
      window.api.request<ZkbStats>(`https://zkillboard.com/api/stats/characterID/${pilot.id}/`),
      window.api.request<Killmail[]>(`https://zkillboard.com/api/characterID/${pilot.id}/`).catch(() => [] as Killmail[])
    ])
    const recent = (Array.isArray(kills) ? kills : []).slice(0, 40)
    const names = await resolveNames([
      ...recent.flatMap((k) => [k.victim.character_id ?? 0, k.victim.corporation_id ?? 0, ...k.attackers.slice(0, 30).map((a) => a.character_id ?? 0)]),
      stats?.info?.corporation_id ?? 0,
      stats?.info?.alliance_id ?? 0
    ])
    const systems = new Map<number, SystemInfo>()
    await Promise.all(
      [...new Set(recent.map((k) => k.solar_system_id))].map((id) =>
        systemInfo(id)
          .then((s) => systems.set(id, s))
          .catch(() => {})
      )
    )
    return { stats: stats ?? {}, recent, names, systems }
  }, [pilot.id])

  if (loading) return <Loading label="Запрашиваю zKillboard…" />
  if (!data) return <ErrorBox error={error} />
  const { stats, recent, names, systems } = data
  const efficiency = (stats.iskDestroyed ?? 0) + (stats.iskLost ?? 0) ? ((stats.iskDestroyed ?? 0) / ((stats.iskDestroyed ?? 0) + (stats.iskLost ?? 0))) * 100 : null

  return (
    <>
      <Card>
        <div className="hero-body">
          <img className="portrait" src={imageUrl.portrait(pilot.id, 128)} alt="" />
          <div className="hero-main">
            <h2>{pilot.name}</h2>
            <div className="org">
              {stats.info?.corporation_id && (
                <>
                  <img src={imageUrl.corpLogo(stats.info.corporation_id, 32)} width={20} height={20} alt="" />
                  {names.get(stats.info.corporation_id)}
                </>
              )}
              {stats.info?.alliance_id ? (
                <>
                  <span className="muted">·</span>
                  <img src={imageUrl.allianceLogo(stats.info.alliance_id, 32)} width={20} height={20} alt="" />
                  {names.get(stats.info.alliance_id)}
                </>
              ) : null}
            </div>
            <a href={`https://zkillboard.com/character/${pilot.id}/`} target="_blank" rel="noreferrer">
              Открыть на zKillboard
            </a>
          </div>
        </div>
      </Card>

      <div className="stats-row">
        <Stat label="Уничтожено" value={fmtNum(stats.shipsDestroyed ?? 0)} sub={fmtIsk(stats.iskDestroyed ?? 0, true)} />
        <Stat label="Потеряно" value={fmtNum(stats.shipsLost ?? 0)} sub={fmtIsk(stats.iskLost ?? 0, true)} />
        <Stat label="ISK-эффективность" value={efficiency == null ? '—' : `${efficiency.toFixed(1)}%`} />
        <Stat label="Соло-киллов" value={fmtNum(stats.soloKills ?? 0)} sub={stats.dangerRatio !== undefined ? `Опасность ${stats.dangerRatio}% · в банде ${stats.gangRatio ?? 0}%` : undefined} />
      </div>

      <Card title="Последние бои">
        {!recent.length ? (
          <Empty>Нет данных на zKillboard.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Корабль</th>
                <th>Жертва</th>
                <th>Система</th>
                <th className="num">Нападавших</th>
                <th className="num">Стоимость</th>
                <th className="num">Когда</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((k) => {
                const loss = k.victim.character_id === pilot.id
                const sys = systems.get(k.solar_system_id)
                const isOpen = open === k.killmail_id
                return (
                  <Fragment key={k.killmail_id}>
                  <tr className="clickable" onClick={() => setOpen(isOpen ? null : k.killmail_id)}>
                    <td>
                      <span className={`badge ${loss ? 'loss' : 'kill'}`}>{loss ? 'Лосс' : 'Килл'}</span>
                    </td>
                    <td>
                      <TypeLink id={k.victim.ship_type_id} size={24} />
                    </td>
                    <td>
                      {names.get(k.victim.character_id ?? 0) ?? <span className="muted">—</span>}
                      <div className="muted small">{names.get(k.victim.corporation_id ?? 0)}</div>
                    </td>
                    <td>{sys ? <><Sec value={sys.security_status} /> {sys.name}</> : k.solar_system_id}</td>
                    <td className="num">
                      {k.attackers.length}
                      {k.zkb.solo && <span className="muted"> соло</span>}
                    </td>
                    <td className="num">{fmtIsk(k.zkb.totalValue, true)}</td>
                    <td className="num muted">{fmtAgo(k.killmail_time)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="sub-row">
                      <td colSpan={7}>
                        <KillDetails k={k} names={names} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">Данные: zKillboard. Нажмите на строку — фит жертвы и список атакующих.</p>
      </Card>
    </>
  )
}
