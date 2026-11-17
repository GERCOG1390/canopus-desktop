// Damage over distance (Pyfa's main graph): what the fit lands on a chosen target at every range, next to up to
// three other fits, with the fit's own webs and painters counted where they reach.

import { useMemo, useState } from 'react'
import type { FitSpec, FitStats, SkillSource } from '../../../shared/fit'
import { appliedAt, curveAlong, distanceTicks, dpsCurve, type GraphAxis, type GraphPoint, effectiveRange, graphReach, TARGET_PRESETS, type GraphTarget, type WeaponKind } from '../../../shared/dpsGraph.ts'
import { Glyph } from '../components/Glyph'
import { TypeLink } from '../components/TypeLink'
import { ErrorBox, Loading } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { locale, translate } from '../i18n'
import { AddFitSelect } from './FitTools'

const SERIES = ['#3dbf9c', '#ff7b72', '#4ea6e8', '#d9a6ff']
const PRESET_LABEL: Record<string, string> = {
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
const AXIS_LABEL: Record<GraphAxis, string> = { distance: 'Дистанция', speed: 'Скорость цели', sig: 'Сигнатура цели' }
const KIND_LABEL: Record<WeaponKind, string> = {
  turret: 'Турели',
  missile: 'Ракеты',
  drone: 'Дроны',
  smartbomb: 'Смартбомбы',
  vorton: 'Вортон'
}

const n0 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 0 })
const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const km = (m: number) => `${n1(m / 1000)} км`

export function FitGraph({ fit, skills }: { fit: FitSpec; skills: SkillSource }) {
  const [others, setOthers] = useState<FitSpec[]>([])
  const [target, setTarget] = useState<GraphTarget>({ sig: 130, speed: 230, angle: 90, ownEwar: true })
  const [hover, setHover] = useState<number | null>(null)
  const [axis, setAxis] = useState<GraphAxis>('distance')
  /** km, for the speed and signature axes */
  const [atKm, setAtKm] = useState(10)
  const fits = [fit, ...others]
  const stats = useAsync(() => Promise.all(fits.map((f) => window.api.fit.calculate(f, skills))), [JSON.stringify(fits), JSON.stringify(skills)])

  const preset = TARGET_PRESETS.find((p) => p.sig === target.sig && p.speed === target.speed)?.id
  const set = (patch: Partial<GraphTarget>) => setTarget((t) => ({ ...t, ...patch }))

  return (
    <>
      <div className="row graph-presets">
        <span className="muted small">Цель:</span>
        {TARGET_PRESETS.map((p) => (
          <button key={p.id} className={`chip-btn ${preset === p.id ? 'active' : ''}`} onClick={() => set({ sig: p.sig, speed: p.speed })}>
            {PRESET_LABEL[p.id]}
          </button>
        ))}
      </div>
      <div className="row graph-target">
        <label>
          <span className="muted small">Сигнатура, м</span>
          <input type="number" min={1} value={target.sig} onChange={(e) => set({ sig: Math.max(1, Number(e.target.value) || 0) })} />
        </label>
        <label>
          <span className="muted small">Скорость, м/с</span>
          <input type="number" min={0} value={target.speed} onChange={(e) => set({ speed: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label title="0° — цель летит прямо от вас, 90° — поперёк (орбита), 180° — прямо на вас">
          <span className="muted small">{`Угол движения: ${target.angle}°`}</span>
          <input type="range" min={0} max={180} step={5} value={target.angle} onChange={(e) => set({ angle: Number(e.target.value) })} />
        </label>
        <label>
          <span className="muted small">Ваша скорость, м/с</span>
          <input type="number" min={0} value={target.shooterSpeed ?? 0} onChange={(e) => set({ shooterSpeed: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label title="0° — вы летите прямо на цель, 90° — поперёк, 180° — прямо от неё">
          <span className="muted small">{`Ваш угол: ${target.shooterAngle ?? 0}°`}</span>
          <input type="range" min={0} max={180} step={5} value={target.shooterAngle ?? 0} onChange={(e) => set({ shooterAngle: Number(e.target.value) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={target.ownEwar} onChange={(e) => set({ ownEwar: e.target.checked })} />
          <span>Свои вебы и пейнтеры</span>
        </label>
        <AddFitSelect onAdd={(f) => setOthers((o) => [...o, f].slice(-3))} />
      </div>
      <div className="row graph-axis">
        <span className="muted small">По оси X:</span>
        {(['distance', 'speed', 'sig'] as GraphAxis[]).map((a) => (
          <button key={a} className={`chip-btn ${axis === a ? 'active' : ''}`} onClick={() => (setAxis(a), setHover(null))}>
            {AXIS_LABEL[a]}
          </button>
        ))}
        {axis !== 'distance' && (
          <label className="row">
            <span className="muted small">на дистанции, км</span>
            <input type="number" min={0} value={atKm} onChange={(e) => setAtKm(Math.max(0, Number(e.target.value) || 0))} />
          </label>
        )}
      </div>
      {stats.loading && !stats.data ? (
        <Loading label="Считаю…" />
      ) : stats.error ? (
        <ErrorBox error={stats.error} />
      ) : stats.data ? (
        <Chart fits={fits} stats={stats.data} target={target} axis={axis} atDistance={atKm * 1000} hover={hover} setHover={setHover} onRemove={(i) => setOthers((o) => o.filter((_, k) => k !== i - 1))} />
      ) : null}
      <p className="muted small">
        Средний урон с учётом шанса попадания, фоллофа, наводки, применения ракет и дальности управления дронами. Все фиты считаются с навыками, выбранными в фитинге.
      </p>
    </>
  )
}

function Chart({
  fits,
  stats,
  target,
  axis,
  atDistance,
  hover,
  setHover,
  onRemove
}: {
  fits: FitSpec[]
  stats: FitStats[]
  target: GraphTarget
  axis: GraphAxis
  atDistance: number
  hover: number | null
  setHover: (d: number | null) => void
  onRemove: (i: number) => void
}) {
  // The x axis: distance (to past the longest weapon), or the target's speed or signature at one distance.
  const reach = useMemo(
    () => (axis === 'distance' ? graphReach(stats) : axis === 'speed' ? Math.max(2000, niceCeil(target.speed * 3)) : Math.max(500, niceCeil(target.sig * 4))),
    [stats, axis, target.speed, target.sig]
  )
  const pointAt = (s: FitStats, v: number) => (axis === 'distance' ? appliedAt(s, target, v) : appliedAt(s, axis === 'speed' ? { ...target, speed: v } : { ...target, sig: Math.max(1, v) }, atDistance))
  const curves = useMemo(
    () =>
      stats.map((s) =>
        axis === 'distance' ? dpsCurve(s, target, reach) : curveAlong(s, target, axis, reach, atDistance).map((p): GraphPoint => ({ distance: p.x, dps: p.dps, byKind: {}, speed: 0, sig: 0 }))
      ),
    [stats, target, reach, axis, atDistance]
  )
  const fmtX = (v: number) => (axis === 'distance' ? km(v) : axis === 'speed' ? `${n0(v)} м/с` : `${n0(v)} м`)
  const top = Math.max(10, ...curves.flat().map((p) => p.dps))
  const yTop = niceCeil(top)
  const W = 860
  const H = 280
  const pad = { l: 52, r: 14, t: 28, b: 28 }
  const x = (d: number) => pad.l + (d / reach) * (W - pad.l - pad.r)
  const y = (v: number) => H - pad.b - (v / yTop) * (H - pad.t - pad.b)
  const path = (pts: { distance: number; dps: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.distance).toFixed(1)},${y(p.dps).toFixed(1)}`).join(' ')
  const xTicks = distanceTicks(reach)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yTop)
  // One fit with several weapon kinds: each kind as a thin dashed line under the total.
  const kinds = stats.length === 1 && axis === 'distance' ? (Object.keys(curves[0][0]?.byKind ?? {}) as WeaponKind[]) : []
  const at = hover === null ? null : stats.map((s) => pointAt(s, hover))

  const unfit = fits.map((f, i) => (stats[i].problems.length ? f.name : null)).filter(Boolean)
  return (
    <div className="dps-graph">
      {unfit.length > 0 && <div className="warn-box small">{`${translate('Фит не собирается в игре (см. проблемы в фиттинге):')} ${unfit.join(', ')}`}</div>}
      <div className="graph-legend">
        {fits.map((f, i) => (
          <span key={i} className="graph-legend-item">
            <i style={{ background: SERIES[i] }} />
            <TypeLink id={f.shipTypeId} size={18} />
            <span className="muted small" translate="no">
              {f.name}
            </span>
            {i > 0 && (
              <button className="ghost small" onClick={() => onRemove(i)} title="Убрать из графика">
                <Glyph name="close" size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const d = ((((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r)) * reach
          setHover(d >= 0 && d <= reach ? d : null)
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">
              {n0(v)}
            </text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text key={d} x={x(d)} y={H - 8} textAnchor={i === 0 ? 'start' : x(d) > W - pad.r - 20 ? 'end' : 'middle'}>
            {fmtX(d)}
          </text>
        ))}
        <text x={pad.l} y={12} textAnchor="start" className="axis-name">
          DPS
        </text>
        {kinds.length > 1 &&
          kinds.map((k) => <path key={k} d={path(curves[0].map((p) => ({ distance: p.distance, dps: p.byKind[k] ?? 0 })))} className="kind-line" />)}
        {curves.map((c, i) => (
          <path key={i} d={path(c)} className="series" style={{ stroke: SERIES[i] }} />
        ))}
        {hover !== null && at && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="hover" />
            {at.map((p, i) => (
              <circle key={i} cx={x(hover)} cy={y(p.dps)} r={4.5} className="dot" style={{ fill: SERIES[i] }} />
            ))}
          </g>
        )}
      </svg>
      <table className="table compact graph-table">
        <thead>
          <tr>
            <th />
            <th className="num">Лучший DPS</th>
            {axis === 'distance' && (
              <th className="num" title="Дальше этой дистанции фит наносит меньше половины своего лучшего урона">
                Рабочая дистанция
              </th>
            )}
            <th className="num">{hover === null ? 'Под курсором' : fmtX(hover)}</th>
            {kinds.length > 1 && hover !== null && kinds.map((k) => <th key={k} className="num">{KIND_LABEL[k]}</th>)}
          </tr>
        </thead>
        <tbody>
          {curves.map((c, i) => {
            const best = c.reduce((b, p) => (p.dps > b.dps ? p : b), c[0])
            return (
              <tr key={i}>
                <td>
                  <i className="graph-swatch" style={{ background: SERIES[i] }} />
                  <span translate="no">{fits[i].name}</span>
                </td>
                <td className="num">
                  {n0(best?.dps ?? 0)} <span className="muted small">{best?.dps ? `· ${fmtX(best.distance)}` : ''}</span>
                </td>
                {axis === 'distance' && <td className="num">{effectiveRange(c) ? km(effectiveRange(c)) : '—'}</td>}
                <td className="num">{at ? n0(at[i].dps) : '—'}</td>
                {kinds.length > 1 && hover !== null && at && kinds.map((k) => <td key={k} className="num">{n0(at[i].byKind[k] ?? 0)}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
      {at && axis === 'distance' && target.ownEwar && (at[0].speed !== target.speed || at[0].sig !== target.sig) && (
        <div className="muted small">
          <span>Под вашими вебами и пейнтерами на этой дистанции цель летит</span> <b>{`${n0(at[0].speed)} м/с`}</b>
          <span>, сигнатура</span> <b>{`${n0(at[0].sig)} м`}</b>.
        </div>
      )}
    </div>
  )
}

/** The next round number above v for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}
