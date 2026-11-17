// Ammo side by side (Pyfa's ammo table): each weapon of the fit with every charge it takes, loaded into all of
// its copies — DPS, volley, reach, tracking or explosion — and the one that lands most on the graph's target.

import { useMemo, useState } from 'react'
import type { FitSpec, FitStats, SkillSource, WeaponStats } from '../../../shared/fit'
import { appliedAt, TARGET_PRESETS } from '../../../shared/dpsGraph.ts'
import { TypeLink } from '../components/TypeLink'
import { Empty, ErrorBox, Loading } from '../components/ui'
import { chargesFor } from '../lib/fitting'
import { useAsync } from '../lib/useAsync'
import { locale } from '../i18n'

const n0 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 0 })
const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const km = (m: number) => `${n1(m / 1000)} км`
const DMG = ['em', 'th', 'ki', 'ex']

interface Row {
  charge: number
  weapons: WeaponStats[]
  stats: FitStats
}

export function FitAmmo({ fit, skills, onChange }: { fit: FitSpec; skills: SkillSource; onChange: (f: FitSpec) => void }) {
  // Weapons that take charges: one table per module type.
  const groups = useMemo(() => [...new Set(fit.modules.filter((m) => m.chargeTypeId !== undefined || m.slot === 'hi').map((m) => m.typeId))], [fit.modules])
  const [target, setTarget] = useState('cruiser')
  const [distance, setDistance] = useState(10)
  const data = useAsync(async () => {
    const out: { module: number; rows: Row[] }[] = []
    for (const module of groups) {
      const charges = await chargesFor(module)
      if (!charges.length) continue
      const rows = await Promise.all(
        charges.map(async (charge) => {
          const spec = { ...fit, modules: fit.modules.map((m) => (m.typeId === module ? { ...m, chargeTypeId: charge } : m)) }
          const stats = await window.api.fit.calculate(spec, skills)
          return { charge, stats, weapons: stats.offense.weapons.filter((w) => w.typeId === module) }
        })
      )
      out.push({ module, rows: rows.filter((r) => r.weapons.length) })
    }
    return out
  }, [JSON.stringify(fit), JSON.stringify(skills), groups.join(',')])

  const preset = TARGET_PRESETS.find((p) => p.id === target) ?? TARGET_PRESETS[0]
  const applied = (r: Row) => {
    const only = { ...r.stats, offense: { ...r.stats.offense, weapons: r.weapons } }
    return appliedAt(only, { sig: preset.sig, speed: preset.speed, angle: 90, ownEwar: true }, distance * 1000).dps
  }

  if (data.loading && !data.data) return <Loading label="Считаю каждый заряд…" />
  if (data.error) return <ErrorBox error={data.error} />
  if (!data.data?.length) return <Empty>В фите нет оружия, которое заряжается.</Empty>
  return (
    <>
      <div className="row">
        <span className="muted small">По цели:</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {TARGET_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {TARGET_LABEL[p.id] ?? p.id}
            </option>
          ))}
        </select>
        <label className="row ammo-distance">
          <span className="muted small">на дистанции, км</span>
          <input type="number" min={0} value={distance} onChange={(e) => setDistance(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>
      {data.data.map(({ module, rows }) => {
        const best = Math.max(...rows.map(applied))
        const current = fit.modules.find((m) => m.typeId === module)?.chargeTypeId
        return (
          <div key={module} className="ammo-group">
            <h4>
              <TypeLink id={module} size={20} />
            </h4>
            <table className="table compact ammo-table">
              <thead>
                <tr>
                  <th>Заряд</th>
                  <th className="num">DPS</th>
                  <th className="num">Залп</th>
                  <th>Урон</th>
                  <th className="num">Дальность</th>
                  <th className="num" title="Наводка турелей или радиус и скорость взрыва ракет">
                    Применение
                  </th>
                  <th className="num" title="Средний урон по выбранной цели на выбранной дистанции">
                    По цели
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => applied(b) - applied(a))
                  .map((r) => {
                    const w = r.weapons[0]
                    const dps = r.weapons.reduce((s, x) => s + x.dps, 0)
                    const volley = r.weapons.reduce((s, x) => s + x.volley, 0)
                    const total = w.damage.reduce((s, x) => s + x, 0) || 1
                    const reach = w.kind === 'turret' ? `${km(w.optimal ?? 0)} + ${km(w.falloff ?? 0)}` : km(w.optimal ?? 0)
                    const use = w.kind === 'turret' ? n1(w.tracking ?? 0) : `${n0(w.explosionRadius ?? 0)} м · ${n0(w.explosionVelocity ?? 0)} м/с`
                    const a = applied(r)
                    return (
                      <tr key={r.charge} className={r.charge === current ? 'ammo-current' : ''}>
                        <td>
                          <TypeLink id={r.charge} size={20} />
                        </td>
                        <td className="num">{n0(dps)}</td>
                        <td className="num">{n0(volley)}</td>
                        <td>
                          <span className="ammo-dmg">
                            {w.damage.map((d, i) => (d > 0 ? <span key={i} className={`dmg-seg dmg-${DMG[i]}`} style={{ width: `${(d / total) * 100}%` }} /> : null))}
                          </span>
                        </td>
                        <td className="num">{reach}</td>
                        <td className="num">{use}</td>
                        <td className={`num ${a === best && best > 0 ? 'good' : ''}`}>{n0(a)}</td>
                        <td>
                          {r.charge !== current && (
                            <button className="ghost small" onClick={() => onChange({ ...fit, modules: fit.modules.map((m) => (m.typeId === module ? { ...m, chargeTypeId: r.charge } : m)) })}>
                              Зарядить
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )
      })}
    </>
  )
}

const TARGET_LABEL: Record<string, string> = {
  ideal: 'Идеальная цель',
  frigate: 'Фрегат',
  frigateAb: 'Фрегат на АБ',
  frigateMwd: 'Фрегат на МВД',
  destroyer: 'Эсминец',
  cruiser: 'Крейсер',
  cruiserMwd: 'Крейсер на МВД',
  battlecruiser: 'Линейный крейсер',
  battleship: 'Линкор',
  structure: 'Структура'
}
