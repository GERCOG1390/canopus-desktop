// Fit optimizer: swaps fitted modules and drones for other versions of the same item (Tech I, Tech II,
// faction, deadspace...) to pay less for the same numbers, or to pay a little more for a big gain.
// Prices are what buying in Jita costs: the cheapest 5% of the volume on sale, not one cheap order.

import { useMemo, useState } from 'react'
import type { FitMetrics, FitSpec, FitVariant, SkillSource } from '../../../shared/fit'
import { TypeLink } from '../components/TypeLink'
import { Empty, ErrorBox, Loading } from '../components/ui'
import { fmtIsk } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { buyPrice, type SellSide } from '../../../shared/fitPrice.ts'
import { useAsync } from '../lib/useAsync'
import { locale, translate } from '../i18n'
import { useLang } from '../AppContext'
import { tn, useTypeBasics } from '../lib/sde'
import { shownChange, workLoss, type AttrChange } from '../../../shared/moduleCompare.ts'

type Mode = 'cheaper' | 'better'
export type Metric = 'dps' | 'ehp' | 'activeTank' | 'speed' | 'align' | 'lockRange' | 'cap' | 'range' | 'application'

export const METRICS: [Metric, string][] = [
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
export function gain(m: FitMetrics, b: FitMetrics, k: Metric): number {
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
export function keeps(m: FitMetrics, b: FitMetrics, tol: number): boolean {
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
export function sideEffects(m: FitMetrics, b: FitMetrics, skip?: Metric): string {
  return [
    ...METRICS.filter(([k]) => k !== skip).map(([k, label]) => [label, gain(m, b, k)] as const),
    ...EXTRA.map(([k, label, dir]) => [label, rel(m[k] as number, b[k] as number, dir)] as const)
  ]
    .filter(([, g]) => Math.abs(g) >= 1)
    .map(([label, g]) => `${translate(label)} ${pct(g)}`)
    .join(' · ')
}

/**
 * What the module itself does differently, by the game's own attribute names: "Optimal Range −17%". Losses first;
 * fitting costs only when they grow. Heat only matters when overheating, so it is left out here.
 */
export function OwnEffects({ own }: { own: AttrChange[] }) {
  const lang = useLang()
  const shown = own.filter((c) => Math.abs(c.change) >= 0.01 && (c.role === 'work' || (c.role === 'cost' && c.worse)))
  if (!shown.length) return null
  return (
    <span translate="no">
      {shown.map((c, i) => (
        <span key={c.attr} className={c.worse ? 'bad' : 'good'}>
          {i > 0 && <span className="muted">{' · '}</span>}
          {`${c.dn ? tn(c.dn, lang) : c.name} ${pct(shownChange(c) * 100)}`}
        </span>
      ))}
    </span>
  )
}

/** The same, as plain English text for the assistant: "Optimal Range -17%, CPU usage +20%". */
export function ownText(own: AttrChange[]): string {
  return own
    .filter((c) => Math.abs(c.change) >= 0.01 && (c.role === 'work' || (c.role === 'cost' && c.worse)))
    .map((c) => `${c.dn?.[0] || c.name} ${shownChange(c) > 0 ? '+' : ''}${(shownChange(c) * 100).toFixed(1)}%${c.worse ? ' (worse)' : ''}`)
    .join(', ')
}

/** "Few on sale" under a version's name, when buying the fit's count would empty Jita or nearly. */
function MarketNote({ d, id, qty }: { d: Variants; id: number; qty: number }) {
  const b = d.buy(id, qty)
  if (!b?.thin && !b?.short) return null
  return <div className="small warn-text">{b.short ? `в Jita только ${b.available} шт.` : `мало в Jita: ${b.available} шт.`}</div>
}

/**
 * Every version of one fitted module side by side, as Pyfa's Compare: price, each own attribute that differs (how the
 * number moves against the fitted one, red when worse) and the fit's numbers, with why the version is or isn't offered.
 */
function VariantTable({ d, from, why, onClose }: { d: Variants; from: number; why: (v: FitVariant) => string | null; onClose: () => void }) {
  const lang = useLang()
  const rows = d.options.filter((v) => v.from === from).sort((x, y) => (d.price(x.to) ?? Infinity) - (d.price(y.to) ?? Infinity))
  if (!rows.length) return null
  const count = rows[0].count
  const cols = new Map<number, AttrChange>()
  for (const v of rows) for (const c of v.own) if (c.role !== 'heat' && Math.abs(shownChange(c)) >= 0.005 && !cols.has(c.attr)) cols.set(c.attr, c)
  const order = [...cols.values()].sort((x, y) => (x.role === y.role ? 0 : x.role === 'work' ? -1 : 1))
  const cur = d.price(from)
  return (
    <div className="fit-variants">
      <div className="row">
        <b>
          {count > 1 && <span className="muted">{`${count}× `}</span>}
          <TypeLink id={from} size={18} />
        </b>
        <span className="muted small">Все версии: цена и чем отличаются от установленной</span>
        <button className="ghost small" onClick={onClose}>
          Скрыть
        </button>
      </div>
      <div className="fit-variants-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Версия</th>
              <th className="num">Цена за шт.</th>
              <th>Вердикт</th>
              {order.map((c) => (
                <th key={c.attr} className="num" translate="no">
                  {c.dn ? tn(c.dn, lang) : c.name}
                </th>
              ))}
              <th>Цифры фита</th>
            </tr>
          </thead>
          <tbody>
            <tr className="fit-variants-current">
              <td>
                <TypeLink id={from} size={18} />
                <span className="muted small fit-variants-tag">установлен</span>
              </td>
              <td className="num">{cur === undefined ? '—' : fmtIsk(cur, true)}</td>
              <td />
              {order.map((c) => (
                <td key={c.attr} />
              ))}
              <td />
            </tr>
            {rows.map((v) => {
              const p = d.price(v.to)
              const no = why(v)
              return (
                <tr key={v.to}>
                  <td>
                    <TypeLink id={v.to} size={18} />
                    <MarketNote d={d} id={v.to} qty={v.count} />
                  </td>
                  <td className={`num ${p !== undefined && cur !== undefined && p < cur ? 'good' : ''}`}>{p === undefined ? '—' : fmtIsk(p, true)}</td>
                  <td className="small">{no ? <span className="muted">{no}</span> : <span className="good">подходит</span>}</td>
                  {order.map((col) => {
                    const c = v.own.find((x) => x.attr === col.attr)
                    return (
                      <td key={col.attr} className={`num ${c ? (c.worse ? 'bad' : 'good') : ''}`}>
                        {c && Math.abs(shownChange(c)) >= 0.005 ? pct(shownChange(c) * 100) : ''}
                      </td>
                    )
                  })}
                  <td className="muted small">{sideEffects(v.metrics, d.base)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** One chip per fitted module type, each opening its table of versions. */
function VariantPicker({ d, open, setOpen }: { d: Variants; open: number | null; setOpen: (id: number | null) => void }) {
  const lang = useLang()
  const ids = [...new Set(d.options.map((v) => v.from))]
  const basic = useTypeBasics(ids)
  if (!ids.length) return null
  return (
    <div className="row fit-variant-chips">
      <span className="muted small">Все версии модуля:</span>
      {ids.map((id) => (
        <button key={id} className={`chip-btn ${open === id ? 'active' : ''}`} translate="no" onClick={() => setOpen(open === id ? null : id)}>
          {tn(basic(id)?.n, lang) || `#${id}`}
        </button>
      ))}
    </div>
  )
}

export function swap(fit: FitSpec, v: FitVariant): FitSpec {
  return v.kind === 'module'
    ? { ...fit, modules: fit.modules.map((m) => (m.typeId === v.from ? { ...m, typeId: v.to } : m)) }
    : { ...fit, drones: fit.drones.map((d) => (d.typeId === v.from ? { ...d, typeId: v.to } : d)) }
}

export type Variants = Awaited<ReturnType<typeof loadVariants>>

/** Every other version of each fitted module / drone type with its numbers, and Jita prices. */
export async function loadVariants(fit: FitSpec, skills: SkillSource) {
  const v = await window.api.fit.variants(fit, skills)
  const ids = [...new Set([...v.options.flatMap((o) => [o.from, o.to])])]
  const prices = ids.length ? await jitaPrices(ids) : new Map()
  /** Buying `qty` of the type in Jita: price per unit and how much is on sale */
  const buy = (id: number, qty = 1) => buyPrice(prices.get(id)?.sell as SellSide | undefined, qty)
  const price = (id: number): number | undefined => buy(id)?.unit
  return { ...v, price, buy }
}

/** Why a version is not offered as a cheaper swap, or null when it is. */
export function cheaperBlock(v: FitVariant, d: Variants, tol: number): string | null {
  const a = d.price(v.from)
  const b = d.buy(v.to, v.count)
  if (v.missingSkills) return 'не хватает навыков'
  if (!b) return 'нет в продаже в Jita'
  if (b.short) return `в Jita только ${b.available} шт.`
  if (a === undefined) return 'нет цены текущего модуля'
  if (b.unit >= a) return 'не дешевле'
  if (!v.metrics.fits && d.base.fits) return 'не влезает по ресурсам'
  if (!keeps(v.metrics, d.base, tol)) return 'хуже по цифрам фита'
  // What the module itself does (a scrambler's range, a web's strength…) has to hold too.
  if (workLoss(v.own) > tol + 1e-9) return 'хуже сам модуль'
  return null
}

/** An upgrade's gain and extra cost, or why the version is not one. */
export function upgradeCheck(v: FitVariant, d: Variants, metric: Metric, budget: number): { g: number; cost: number } | string {
  const a = d.price(v.from)
  const b = d.buy(v.to, v.count)
  if (v.missingSkills) return 'не хватает навыков'
  if (!b) return 'нет в продаже в Jita'
  if (b.short) return `в Jita только ${b.available} шт.`
  if (a === undefined) return 'нет цены текущего модуля'
  if (!v.metrics.fits && d.base.fits) return 'не влезает по ресурсам'
  const g = gain(v.metrics, d.base, metric)
  if (g < 0.5) return 'не улучшает выбранное'
  // A gain bought with a big loss elsewhere (Polarized weapons: no resists) is not an upgrade.
  if (METRICS.some(([k]) => k !== metric && gain(v.metrics, d.base, k) < -3)) return 'хуже по цифрам фита'
  if (workLoss(v.own) > 0.03) return 'хуже сам модуль'
  const cost = (b.unit - a) * v.count
  if (cost > budget) return 'доплата больше выбранной'
  return { g, cost }
}

/** Per module type the biggest saving that keeps the numbers, then the picks checked together. */
export async function findCheaper(d: Variants, fit: FitSpec, skills: SkillSource, tol: number) {
  const best = new Map<number, { v: FitVariant; saving: number }>()
  for (const v of d.options) {
    if (cheaperBlock(v, d, tol)) continue
    const saving = (d.price(v.from)! - d.price(v.to)!) * v.count
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
}

/** Swaps that add the most to `metric` per million ISK, within `budget` per swap and without big losses elsewhere. */
export function findUpgrades(d: Variants, metric: Metric, budget: number) {
  return d.options
    .map((v) => {
      const r = upgradeCheck(v, d, metric, budget)
      return typeof r === 'string' ? null : { v, ...r }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    // Cheaper and better first, then the most gain per million ISK.
    .sort((x, y) => (x.cost <= 0 || y.cost <= 0 ? x.cost - y.cost : y.g / (y.cost / 1e6) - x.g / (x.cost / 1e6)))
    .slice(0, 25)
}

export function FitOptimize({ fit, skills, onChange }: { fit: FitSpec; skills: SkillSource; onChange: (f: FitSpec) => void }) {
  const [mode, setMode] = useState<Mode>('cheaper')
  const [tol, setTol] = useState(0)
  const [metric, setMetric] = useState<Metric>('dps')
  /** Most extra ISK for one swap in "better" mode */
  const [budget, setBudget] = useState(200e6)
  /** The module type whose versions are shown side by side */
  const [open, setOpen] = useState<number | null>(null)

  const data = useAsync(() => loadVariants(fit, skills), [JSON.stringify(fit), JSON.stringify(skills)])
  const cheaper = useAsync(async () => (data.data && mode === 'cheaper' ? findCheaper(data.data, fit, skills, tol) : null), [data.data, mode, tol])

  if (data.loading) return <Loading label="Перебираю версии модулей и цены в Jita…" />
  if (data.error) return <ErrorBox error={data.error} />
  const d = data.data
  if (!d) return null

  const better = mode === 'better' ? findUpgrades(d, metric, budget) : []
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
                    <th />
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
                        <MarketNote d={d} id={v.to} qty={v.count} />
                      </td>
                      <td className="num good">{fmtIsk(saving, true)}</td>
                      <td className="muted small">
                        {sideEffects(v.metrics, d.base) && <div>{sideEffects(v.metrics, d.base)}</div>}
                        <OwnEffects own={v.own} />
                        {!sideEffects(v.metrics, d.base) && !v.own.some((c) => c.role === 'work' && Math.abs(c.change) >= 0.01) && <span>без изменений</span>}
                      </td>
                      <td>
                        <button className="ghost small nowrap" onClick={() => setOpen(open === v.from ? null : v.from)}>
                          Все версии
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <b className="good">{`Всего экономия ${fmtIsk(
                  cheaper.data.picks.reduce((s, p) => s + p.saving, 0),
                  true
                )}`}</b>
                {cheaper.data.combined && (
                  <span className="muted small">
                    {sideEffects(cheaper.data.combined, d.base) ||
                      (cheaper.data.picks.some((p) => p.v.own.some((c) => c.role === 'work' && Math.abs(c.change) >= 0.01)) ? 'Цифры фита те же; что меняется в модулях — в таблице' : 'ТТХ не меняются')}
                  </span>
                )}
                <button onClick={() => onChange(cheaper.data!.picks.reduce((f, p) => swap(f, p.v), fit))}>Применить все замены</button>
              </div>
            </>
          )}
          <p className="muted small">
            Сравниваются урон, дальность и применение оружия, EHP, активный танк, скорость, разгон, сигнатура, захват (дальность и разрешение) и накопитель, а также
            собственные характеристики каждого модуля: дальность, сила, количество, время цикла. Фит должен по-прежнему влезать по процессору, энергосети и калибровке.
            Цены — средняя цена самых дешёвых 5% объёма на продаже в Jita, а не один дешёвый ордер; версии, которых в Jita меньше, чем нужно фиту, не предлагаются.
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
                      <MarketNote d={d} id={v.to} qty={v.count} />
                    </td>
                    <td className="num good">{pct(g)}</td>
                    <td className={`num ${cost <= 0 ? 'good' : ''}`}>{cost <= 0 ? `дешевле на ${fmtIsk(-cost, true)}` : fmtIsk(cost, true)}</td>
                    <td className="muted small">
                      {sideEffects(v.metrics, d.base, metric) && <div>{sideEffects(v.metrics, d.base, metric)}</div>}
                      <OwnEffects own={v.own} />
                    </td>
                    <td className="nowrap">
                      <button className="ghost small" onClick={() => onChange(swap(fit, v))}>
                        Заменить
                      </button>{' '}
                      <button className="ghost small" onClick={() => setOpen(open === v.from ? null : v.from)}>
                        Все версии
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Каждая строка — замена всех модулей этого типа; сначала то, что даёт больше всего на каждый миллион ISK. Не показаны замены, после которых фит не
            влезает по ресурсам или что-то другое, в фите или в самом модуле, ухудшается больше чем на 3%. Цены — средняя цена самых дешёвых 5% объёма на продаже в Jita.
          </p>
        </>
      )}
      <VariantPicker d={d} open={open} setOpen={setOpen} />
      {open !== null && (
        <VariantTable
          d={d}
          from={open}
          why={(v) => {
            if (mode === 'cheaper') return cheaperBlock(v, d, tol)
            const r = upgradeCheck(v, d, metric, budget)
            return typeof r === 'string' ? r : null
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {skipped > 0 && skills.mode === 'char' && <p className="muted small">{`Не предложено ${skipped} версий: персонажу не хватает навыков.`}</p>}
    </>
  )
}
