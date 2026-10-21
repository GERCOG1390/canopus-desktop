// Fit optimizer: swaps fitted modules and drones for other versions of the same item (Tech I, Tech II,
// faction, deadspace...) to pay less for the same numbers, or to pay a little more for a big gain.
// Prices are Jita sell orders.

import { useMemo, useState } from 'react'
import type { FitMetrics, FitSpec, FitVariant, SkillSource } from '../../../shared/fit'
import { TypeLink } from '../components/TypeLink'
import { Empty, ErrorBox, Loading } from '../components/ui'
import { fmtIsk } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { useAsync } from '../lib/useAsync'
import { locale, translate } from '../i18n'

type Mode = 'cheaper' | 'better'
type Metric = 'dps' | 'ehp' | 'activeTank' | 'speed' | 'align' | 'lockRange' | 'cap' | 'range' | 'application'

const METRICS: [Metric, string][] = [
  ['dps', 'Урон (DPS)'],
  ['ehp', 'EHP'],
  ['activeTank', 'Активный танк'],
  ['speed', 'Скорость'],
  ['align', 'Разгон до варпа'],
  ['lockRange', 'Дальность захвата'],
  ['cap', 'Накопитель'],
  ['range', 'Дальность оружия'],
  ['application', 'Применение урона']
]

/** Shown among side effects but not offered as a goal: lower is better for both. */
const EXTRA: [keyof FitMetrics, string, 'up' | 'down'][] = [
  ['signature', 'Сигнатура', 'down'],
  ['scanRes', 'Разрешение сканера', 'up']
]

/** Relative change of a number where `down` means lower is better, %, "better" positive. */
const rel = (x: number, y: number, dir: 'up' | 'down') => (!y ? 0 : dir === 'down' ? ((y - x) / y) * 100 : ((x - y) / y) * 100)

/**
 * Damage application as one number: tracking for turrets, explosion radius (smaller is better) and
 * speed for missiles, the worst of them counts.
 */
function applicationGain(m: FitMetrics, b: FitMetrics): number {
  const parts = [b.tracking ? rel(m.tracking, b.tracking, 'up') : null, b.explosionRadius ? rel(m.explosionRadius, b.explosionRadius, 'down') : null, b.explosionVelocity ? rel(m.explosionVelocity, b.explosionVelocity, 'up') : null].filter((x): x is number => x !== null)
  if (!parts.length) return 0
  const worst = Math.min(...parts)
  return worst < -0.05 ? worst : Math.max(...parts)
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString(locale(), { maximumFractionDigits: 1 })}%`

/** One number for the capacitor: stable fits above unstable ones, then by level or by how long it lasts. */
const capScore = (m: FitMetrics) => (m.capStable ? 100_000 + m.capLevel * 1000 : m.capLasts)

/** Relative change of a metric, %, "better" positive (shorter align time is better). */
function gain(m: FitMetrics, b: FitMetrics, k: Metric): number {
  if (k === 'cap') {
    if (m.capStable && b.capStable) return (m.capLevel - b.capLevel) * 100
    if (m.capStable !== b.capStable) return m.capStable ? 100 : -100
    return b.capLasts ? ((m.capLasts - b.capLasts) / b.capLasts) * 100 : 0
  }
  if (k === 'application') return applicationGain(m, b)
  const x = m[k]
  const y = b[k]
  if (!y) return x > 0 ? 100 : 0
  return k === 'align' ? ((y - x) / y) * 100 : ((x - y) / y) * 100
}

/** Nothing the optimizer watches got worse by more than `tol` (a fraction), and the fit still fits. */
function keeps(m: FitMetrics, b: FitMetrics, tol: number): boolean {
  const ge = (x: number, y: number, eps: number) => x >= y * (1 - tol) - eps
  const cap = b.capStable ? m.capStable && m.capLevel >= b.capLevel - tol - 0.001 : m.capStable || m.capLasts >= b.capLasts * (1 - tol) - 1
  return (
    (m.fits || !b.fits) &&
    ge(m.dps, b.dps, 0.05) &&
    ge(m.ehp, b.ehp, 1) &&
    ge(m.activeTank, b.activeTank, 0.05) &&
    ge(m.speed, b.speed, 0.05) &&
    m.align <= b.align * (1 + tol) + 0.005 &&
    ge(m.lockRange, b.lockRange, 1) &&
    ge(m.scanRes, b.scanRes, 0.5) &&
    m.signature <= b.signature * (1 + tol) + 0.05 &&
    ge(m.range, b.range, 1) &&
    ge(m.tracking, b.tracking, 1e-6) &&
    m.explosionRadius <= b.explosionRadius * (1 + tol) + 0.05 &&
    ge(m.explosionVelocity, b.explosionVelocity, 0.05) &&
    cap
  )
}

/** Short list of what else changes noticeably: "EHP +4%, скорость −2%". */
function sideEffects(m: FitMetrics, b: FitMetrics, skip?: Metric): string {
  return [
    ...METRICS.filter(([k]) => k !== skip).map(([k, label]) => [label, gain(m, b, k)] as const),
    ...EXTRA.map(([k, label, dir]) => [label, rel(m[k] as number, b[k] as number, dir)] as const)
  ]
    .filter(([, g]) => Math.abs(g) >= 1)
    .map(([label, g]) => `${translate(label)} ${pct(g)}`)
    .join(' · ')
}

function swap(fit: FitSpec, v: FitVariant): FitSpec {
  return v.kind === 'module'
    ? { ...fit, modules: fit.modules.map((m) => (m.typeId === v.from ? { ...m, typeId: v.to } : m)) }
    : { ...fit, drones: fit.drones.map((d) => (d.typeId === v.from ? { ...d, typeId: v.to } : d)) }
}

export function FitOptimize({ fit, skills, onChange }: { fit: FitSpec; skills: SkillSource; onChange: (f: FitSpec) => void }) {
  const [mode, setMode] = useState<Mode>('cheaper')
  const [tol, setTol] = useState(0)
  const [metric, setMetric] = useState<Metric>('dps')
  /** Most extra ISK for one swap in "better" mode */
  const [budget, setBudget] = useState(200e6)

  const data = useAsync(async () => {
    const v = await window.api.fit.variants(fit, skills)
    const ids = [...new Set([...v.options.flatMap((o) => [o.from, o.to])])]
    const prices = ids.length ? await jitaPrices(ids) : new Map()
    const price = (id: number): number | undefined => {
      const p = prices.get(id)?.sell.best as number | undefined
      return p && p > 0 ? p : undefined
    }
    return { ...v, price }
  }, [JSON.stringify(fit), JSON.stringify(skills)])

  // Cheaper: per module type the biggest saving that keeps the numbers, then the picks checked together.
  const cheaper = useAsync(async () => {
    const d = data.data
    if (!d || mode !== 'cheaper') return null
    const best = new Map<number, { v: FitVariant; saving: number }>()
    for (const v of d.options) {
      const a = d.price(v.from)
      const b = d.price(v.to)
      if (a === undefined || b === undefined || v.missingSkills || b >= a || !keeps(v.metrics, d.base, tol)) continue
      const saving = (a - b) * v.count
      if ((best.get(v.from)?.saving ?? 0) < saving) best.set(v.from, { v, saving })
    }
    // Swaps can add up (two cheaper modules may not fit CPU together): drop the smallest savings until it holds.
    let picks = [...best.values()].sort((x, y) => y.saving - x.saving)
    let combined: FitMetrics | null = null
    while (picks.length) {
      combined = await window.api.fit.metrics(
        picks.reduce((f, p) => swap(f, p.v), fit),
        skills
      )
      if (keeps(combined, d.base, tol)) break
      picks = picks.slice(0, -1)
      combined = null
    }
    return { picks, combined }
  }, [data.data, mode, tol])

  if (data.loading) return <Loading label="Перебираю версии модулей и цены в Jita…" />
  if (data.error) return <ErrorBox error={data.error} />
  const d = data.data
  if (!d) return null

  const better =
    mode === 'better'
      ? d.options
          .map((v) => {
            const a = d.price(v.from)
            const b = d.price(v.to)
            if (a === undefined || b === undefined || v.missingSkills || (!v.metrics.fits && d.base.fits)) return null
            const g = gain(v.metrics, d.base, metric)
            if (g < 0.5) return null
            // A gain bought with a big loss elsewhere (Polarized weapons: no resists) is not an upgrade.
            if (METRICS.some(([k]) => k !== metric && gain(v.metrics, d.base, k) < -3)) return null
            const cost = (b - a) * v.count
            if (cost > budget) return null
            return { v, g, cost }
          })
          .filter((x): x is NonNullable<typeof x> => !!x)
          // Cheaper and better first, then the most gain per million ISK.
          .sort((x, y) => (x.cost <= 0 || y.cost <= 0 ? x.cost - y.cost : y.g / (y.cost / 1e6) - x.g / (x.cost / 1e6)))
          .slice(0, 25)
      : []
  const skipped = d.options.filter((v) => v.missingSkills).length

  return (
    <>
      <div className="row">
        <button className={`chip-btn ${mode === 'cheaper' ? 'active' : ''}`} onClick={() => setMode('cheaper')}>
          Дешевле при тех же ТТХ
        </button>
        <button className={`chip-btn ${mode === 'better' ? 'active' : ''}`} onClick={() => setMode('better')}>
          Лучше за доплату
        </button>
      </div>

      {mode === 'cheaper' && (
        <>
          <div className="row">
            <span className="muted small">Допустимое ухудшение:</span>
            {[0, 0.02, 0.05, 0.1].map((t) => (
              <button key={t} className={`chip-btn ${tol === t ? 'active' : ''}`} onClick={() => setTol(t)}>
                {t ? `до ${t * 100}%` : 'без ухудшений'}
              </button>
            ))}
          </div>
          {cheaper.loading || !cheaper.data ? (
            <Loading label="Проверяю замены вместе…" />
          ) : !cheaper.data.picks.length ? (
            <Empty>Дешевле без потерь не получается: каждый модуль уже самая дешёвая версия с такими ТТХ.</Empty>
          ) : (
            <>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Сейчас</th>
                    <th>Заменить на</th>
                    <th className="num">Экономия</th>
                    <th>Что меняется</th>
                  </tr>
                </thead>
                <tbody>
                  {cheaper.data.picks.map(({ v, saving }) => (
                    <tr key={v.from}>
                      <td>
                        {v.count > 1 && <span className="muted">{`${v.count}× `}</span>}
                        <TypeLink id={v.from} size={18} />
                      </td>
                      <td>
                        <TypeLink id={v.to} size={18} />
                      </td>
                      <td className="num good">{fmtIsk(saving, true)}</td>
                      <td className="muted small">{sideEffects(v.metrics, d.base) || 'без изменений'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <b className="good">{`Всего экономия ${fmtIsk(
                  cheaper.data.picks.reduce((s, p) => s + p.saving, 0),
                  true
                )}`}</b>
                {cheaper.data.combined && <span className="muted small">{sideEffects(cheaper.data.combined, d.base) || 'ТТХ не меняются'}</span>}
                <button onClick={() => onChange(cheaper.data!.picks.reduce((f, p) => swap(f, p.v), fit))}>Применить все замены</button>
              </div>
            </>
          )}
          <p className="muted small">
            Сравниваются урон, дальность и применение оружия, EHP, активный танк, скорость, разгон, сигнатура, захват (дальность и разрешение) и накопитель; фит должен по-прежнему влезать по процессору,
            энергосети и калибровке. Цены — минимальные ордера на продажу в Jita.
          </p>
        </>
      )}

      {mode === 'better' && (
        <>
          <div className="row">
            <span className="muted small">Что улучшаем:</span>
            {METRICS.map(([m, label]) => (
              <button key={m} className={`chip-btn ${metric === m ? 'active' : ''}`} onClick={() => setMetric(m)}>
                {label}
              </button>
            ))}
          </div>
          <div className="row">
            <span className="muted small">Доплата за одну замену:</span>
            {[50e6, 200e6, 1e9, Infinity].map((b) => (
              <button key={b} className={`chip-btn ${budget === b ? 'active' : ''}`} onClick={() => setBudget(b)}>
                {b === Infinity ? 'любая' : `до ${fmtIsk(b, true)}`}
              </button>
            ))}
          </div>
          {!better.length ? (
            <Empty>В этих пределах другие версии модулей не улучшают выбранную характеристику без заметных потерь в остальном.</Empty>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Сейчас</th>
                  <th>Заменить на</th>
                  <th className="num">Прибавка</th>
                  <th className="num">Доплата</th>
                  <th>Заодно</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {better.map(({ v, g, cost }) => (
                  <tr key={`${v.from}-${v.to}`}>
                    <td>
                      {v.count > 1 && <span className="muted">{`${v.count}× `}</span>}
                      <TypeLink id={v.from} size={18} />
                    </td>
                    <td>
                      <TypeLink id={v.to} size={18} />
                    </td>
                    <td className="num good">{pct(g)}</td>
                    <td className={`num ${cost <= 0 ? 'good' : ''}`}>{cost <= 0 ? `дешевле на ${fmtIsk(-cost, true)}` : fmtIsk(cost, true)}</td>
                    <td className="muted small">{sideEffects(v.metrics, d.base, metric)}</td>
                    <td>
                      <button className="ghost small" onClick={() => onChange(swap(fit, v))}>
                        Заменить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Каждая строка — замена всех модулей этого типа; сначала то, что даёт больше всего на каждый миллион ISK. Не показаны замены, после которых фит не
            влезает по ресурсам или что-то другое ухудшается больше чем на 3%. Цены — минимальные ордера на продажу в Jita.
          </p>
        </>
      )}
      {skipped > 0 && skills.mode === 'char' && <p className="muted small">{`Не предложено ${skipped} версий: персонажу не хватает навыков.`}</p>}
    </>
  )
}
