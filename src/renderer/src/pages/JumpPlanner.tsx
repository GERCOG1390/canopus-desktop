// Capital jump planner: jump range from skills, fewest-jumps route over lowsec/nullsec,
// fuel per jump and the jump fatigue / activation timers along the way.

import { useEffect, useMemo, useState } from 'react'
import type { JumpHop } from '../../../shared/sde'
import { useApp, useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, SearchBox, Sec, Stat } from '../components/ui'
import { esi } from '../lib/esi'
import { fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { CATEGORY, searchSystemsSde, searchTypesSde, tn, useTypeBasic } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { locale } from '../i18n'

const ATTR = { fuelType: 866, range: 867, fuelPerLy: 868 }
const SKILL = { calibration: 21611, conservation: 21610, jumpFreighters: 29029 }
const JUMP_FREIGHTER_GROUP = 902
/** Industrial hulls: jump fatigue counts 10% of the distance. */
const INDUSTRIAL_GROUPS = new Set([902, 883, 941, 513, 28, 1202, 380, 31, 29])
const BLACK_OPS_GROUP = 898
const MAX_FATIGUE_MIN = 300
const MAX_COOLDOWN_MIN = 30

const ly = (v: number) => `${v.toLocaleString(locale(), { maximumFractionDigits: 2 })} св. лет`
const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ч ${Math.round(m % 60)} мин` : `${Math.round(m)} мин`)

interface Sys {
  id: number
  name: string
}

export default function JumpPlanner() {
  const lang = useLang()
  const { active } = useApp()
  const [shipId, setShipId] = useState<number | null>(null)
  const [from, setFrom] = useState<Sys | null>(null)
  const [to, setTo] = useState<Sys | null>(null)
  const [skills, setSkills] = useState<'all5' | 'char'>(active ? 'char' : 'all5')
  const [fatigueStart, setFatigueStart] = useState(0)
  const ship = useTypeBasic(shipId ?? 0)

  const attrs = useAsync(async () => (shipId ? ((await window.api.sde.dogmaAttrs([shipId], Object.values(ATTR)))[shipId] ?? {}) : null), [shipId])
  const charSkills = useAsync(async () => {
    if (!active) return null
    const r = await esi<{ skills: { skill_id: number; active_skill_level: number }[] }>(`/characters/${active.id}/skills/`, { characterId: active.id })
    return new Map(r.skills.map((s) => [s.skill_id, s.active_skill_level]))
  }, [active?.id])
  // Current jump fatigue of the character (esi-characters.read_fatigue.v1).
  useEffect(() => {
    if (!active) return
    esi<{ jump_fatigue_expire_date?: string }>(`/characters/${active.id}/fatigue/`, { characterId: active.id })
      .then((f) => setFatigueStart(f.jump_fatigue_expire_date ? Math.max(0, (Date.parse(f.jump_fatigue_expire_date) - Date.now()) / 60_000) : 0))
      .catch(() => {})
  }, [active?.id])

  const level = (id: number) => (skills === 'all5' || !charSkills.data ? 5 : (charSkills.data.get(id) ?? 0))
  const baseRange = attrs.data?.[ATTR.range] ?? 0
  const range = baseRange * (1 + 0.2 * level(SKILL.calibration))
  const fuelType = attrs.data?.[ATTR.fuelType] ?? 0
  const fuelPerLy =
    (attrs.data?.[ATTR.fuelPerLy] ?? 0) * (1 - 0.1 * level(SKILL.conservation)) * (ship?.g === JUMP_FREIGHTER_GROUP ? 1 - 0.1 * level(SKILL.jumpFreighters) : 1)
  const fatigueFactor = ship && INDUSTRIAL_GROUPS.has(ship.g) ? 0.1 : ship?.g === BLACK_OPS_GROUP ? 0.25 : 1

  const route = useAsync(async () => {
    if (!from || !to || !range) return null
    const hops = await window.api.sde.jumpRoute(from.id, to.id, range)
    if (!hops) return { hops: null as JumpHop[] | null, systems: new Map(), direct: await window.api.sde.lightYears(from.id, to.id) }
    const ids = [...new Set(hops.flatMap((h) => [h.from, h.to]))]
    const systems = new Map((await Promise.all(ids.map((id) => window.api.sde.system(id)))).filter(Boolean).map((s) => [s!.id, s!]))
    return { hops, systems, direct: null }
  }, [from?.id, to?.id, range])
  const fuelPrice = useAsync(async () => (fuelType ? ((await jitaPrices([fuelType])).get(fuelType)?.sell.best ?? 0) : 0), [fuelType])

  // Fatigue along the route, jumping as soon as each activation timer runs out.
  const plan = useMemo(() => {
    const hops = route.data?.hops
    if (!hops) return null
    let fatigue = fatigueStart
    let time = 0
    const rows = hops.map((h, i) => {
      const eff = h.ly * fatigueFactor
      const cooldown = Math.min(MAX_COOLDOWN_MIN, Math.max(1 + eff, fatigue / 10))
      fatigue = Math.min(MAX_FATIGUE_MIN, Math.max(10 * (1 + eff), fatigue * (1 + eff)))
      const fuel = Math.ceil(h.ly * fuelPerLy)
      const row = { ...h, fuel, cooldown, fatigue, at: time }
      if (i < hops.length - 1) {
        time += cooldown
        fatigue = Math.max(0, fatigue - cooldown)
      }
      return row
    })
    return { rows, fuel: rows.reduce((a, r) => a + r.fuel, 0), time, fatigue: rows.at(-1)?.fatigue ?? 0, cooldown: rows.at(-1)?.cooldown ?? 0 }
  }, [route.data, fatigueStart, fatigueFactor, fuelPerLy])

  return (
    <>
      <Card title="Прыжки капиталов">
        <div className="jump-form">
          <label>
            Корабль с прыжковым двигателем
            <SearchBox placeholder={ship ? tn(ship.n, lang) : 'Archon, Revelation, Rhea, Rorqual…'} search={(q) => searchTypesSde(q, lang, { categories: [CATEGORY.SHIP] })} onSelect={(t) => setShipId(t.id)} clearOnSelect />
          </label>
          <label>
            Откуда
            <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setFrom} initial={from?.name ?? ''} />
          </label>
          <label>
            Куда (lowsec или null)
            <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setTo} initial={to?.name ?? ''} />
          </label>
          <label>
            Навыки
            <select value={skills} onChange={(e) => setSkills(e.target.value as typeof skills)}>
              <option value="all5">Все V</option>
              {active && <option value="char">{`Навыки ${active.name}`}</option>}
            </select>
          </label>
          <label>
            Текущая усталость, мин
            <input type="number" min={0} value={Math.round(fatigueStart)} onChange={(e) => setFatigueStart(Math.max(0, Number(e.target.value)))} />
          </label>
        </div>
        {shipId && attrs.data && !baseRange && <div className="warn">У этого корабля нет прыжкового двигателя.</div>}
        {shipId && baseRange > 0 && (
          <div className="stats-row">
            <Stat label="Дальность прыжка" value={ly(range)} sub={`база ${ly(baseRange)}, Jump Drive Calibration ${level(SKILL.calibration)}`} />
            <Stat label="Топливо" value={fuelType ? <TypeLink id={fuelType} size={20} /> : '—'} sub={`${fmtNum(Math.round(fuelPerLy))} ед. на св. год`} />
            <Stat label="Усталость считается от" value={`${fatigueFactor * 100}% дистанции`} sub={fatigueFactor < 1 ? (fatigueFactor === 0.1 ? 'промышленный корабль' : 'Black Ops') : 'боевой капитал'} />
          </div>
        )}
      </Card>

      {!shipId || !from || !to ? (
        <Empty>Выберите корабль, откуда и куда прыгать.</Empty>
      ) : route.loading ? (
        <Loading label="Прокладываю маршрут…" />
      ) : route.error ? (
        <ErrorBox error={route.error} />
      ) : !route.data?.hops ? (
        <Empty>{`Маршрута нет: цель в highsec, в червоточине или вне досягаемости (${route.data?.direct ? ly(route.data.direct) : '?'} напрямую, дальность ${ly(range)}).`}</Empty>
      ) : plan ? (
        <>
          <div className="stats-row">
            <Stat label="Прыжков" value={plan.rows.length} sub={`${ly(plan.rows.reduce((a, r) => a + r.ly, 0))} всего`} />
            <Stat label="Топливо" value={fmtNum(plan.fuel)} sub={fuelPrice.data ? `≈ ${fmtIsk(plan.fuel * fuelPrice.data, true)} по Jita` : undefined} />
            <Stat label="Время в пути" value={minutes(plan.time)} sub="с ожиданием таймеров активации" />
            <Stat label="Усталость по прибытии" value={<span className={plan.fatigue > 120 ? 'bad' : ''}>{minutes(plan.fatigue)}</span>} sub={`таймер следующего прыжка ${minutes(plan.cooldown)}`} />
          </div>
          <Card>
            <table className="table compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Прыжок</th>
                  <th className="num">Дистанция</th>
                  <th className="num">Топливо</th>
                  <th className="num">Старт через</th>
                  <th className="num">Таймер активации</th>
                  <th className="num">Усталость после</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, i) => {
                  const a = route.data!.systems.get(r.from)
                  const b = route.data!.systems.get(r.to)
                  return (
                    <tr key={i}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        {a && <Sec value={a.sec} />} {a?.n} → {b && <Sec value={b.sec} />} <b>{b?.n}</b> <span className="muted small">{b ? tn(b.region, lang) : ''}</span>
                      </td>
                      <td className="num">{ly(r.ly)}</td>
                      <td className="num">{fmtNum(r.fuel)}</td>
                      <td className="num muted">{minutes(r.at)}</td>
                      <td className="num">{minutes(r.cooldown)}</td>
                      <td className={`num ${r.fatigue > 120 ? 'bad' : ''}`}>{minutes(r.fatigue)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="muted small">
              Маршрут: наименьшее число прыжков, затем наименьшая дистанция (меньше усталости), только lowsec и null. Усталость после прыжка — max(10·(1+св. лет), усталость·(1+св.
              лет)), до 5 ч; таймер активации — max(1+св. лет, усталость/10), до 30 мин; усталость тает в реальном времени. Нужен цино в каждой точке.
            </p>
          </Card>
        </>
      ) : null}
    </>
  )
}
