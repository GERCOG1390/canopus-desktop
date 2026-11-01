// Planetary industry calculator: pick a product (P1–P4) and where the chain starts (extract P0, or buy P1 /
// P2 / P3 at Jita), get the production tree — factories per tier, raw resources per hour and the planet
// types that have them — and the profit per hour: output at Jita minus bought inputs and customs taxes.
// Schematics and the taxable base value per tier come from the SDE; which planet types hold which raw
// resource is not in the SDE and is the game's fixed table (EVE University, "Planets").

import { useMemo, useState } from 'react'
import { useApp, useLang } from '../AppContext'
import { TypeLink, TypeName } from '../components/TypeLink'
import { Card, Empty, Loading, SearchBox, Sec, Stat } from '../components/ui'
import { fmtIsk, fmtNum, roundSec } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { searchSystemsSde, tn, useTypeBasics } from '../lib/sde'
import { useAsync } from '../lib/useAsync'

/** Planet type → its name on the planet list in the game. */
export const PLANET_TYPES: Record<number, string> = {
  2016: 'Бесплодная',
  13: 'Газовая',
  12: 'Ледяная',
  2015: 'Лавовая',
  2014: 'Океаническая',
  2063: 'Плазменная',
  2017: 'Грозовая',
  11: 'Умеренная'
}

/** Raw resource (P0) → planet types it can be extracted on. */
export const P0_PLANETS: Record<number, number[]> = {
  2268: [2016, 13, 12, 2014, 2017, 11], // Aqueous Liquids
  2305: [11], // Autotrophs
  2267: [2016, 13, 2015, 2063, 2017], // Base Metals
  2288: [2016, 2014, 11], // Carbon Compounds
  2287: [2014, 11], // Complex Organisms
  2307: [2015], // Felsic Magma
  2272: [12, 2015, 2063], // Heavy Metals
  2309: [13, 2017], // Ionic Solutions
  2073: [2016, 12, 2014, 11], // Microorganisms
  2310: [13, 12, 2017], // Noble Gas
  2270: [2016, 2063], // Noble Metals
  2306: [2015, 2063], // Non-CS Crystals
  2286: [12, 2014], // Planktic Colonies
  2311: [13], // Reactive Gas
  2308: [2015, 2063, 2017] // Suspended Plasma
}

/** Customs taxable value per unit (attribute 1641) → tier. */
const TIER_BY_BASE: Record<number, number> = { 5: 0, 400: 1, 7200: 2, 60000: 3, 1200000: 4 }
const EXPORT_BASE = 1641

interface Node {
  type: number
  tier: number
  /** Units per hour */
  rate: number
  /** Factories running the schematic (fractional: how loaded) */
  factories?: number
  /** How this tier is obtained when not built here */
  source: 'build' | 'buy' | 'extract'
  children: Node[]
}

export default function PiCalculator() {
  const lang = useLang()
  const { sde } = useApp()
  // Asked again once the SDE is (re)built: older databases have no schematics.
  const schematics = useAsync(() => window.api.sde.piSchematics(), [sde.state, sde.build])
  /** Every PI type (inputs and outputs) with its tier and taxable base. */
  const meta = useAsync(async () => {
    const all = Object.values(schematics.data ?? {})
    if (!all.length) return null
    const ids = [...new Set(all.flatMap((s) => [s.out[0], ...s.in.map((i) => i[0])]))]
    const attrs = await window.api.sde.dogmaAttrs(ids, [EXPORT_BASE])
    const base = new Map(ids.map((id) => [id, attrs[id]?.[EXPORT_BASE] ?? 0]))
    const tier = new Map(ids.map((id) => [id, TIER_BY_BASE[base.get(id) ?? -1] ?? 0]))
    return { ids, base, tier }
  }, [schematics.data])
  const basic = useTypeBasics(meta.data?.ids ?? [])

  const byOutput = useMemo(() => new Map(Object.values(schematics.data ?? {}).map((s) => [s.out[0], s])), [schematics.data])
  const [tier, setTier] = useState(2)
  const [product, setProduct] = useState<number | null>(null)
  const [startTier, setStartTier] = useState(0)
  const [rateInput, setRateInput] = useState<number | null>(null)
  const [tax, setTax] = useState(10)
  const [sellBasis, setSellBasis] = useState<'sell' | 'buy'>('sell')
  const [taxImports, setTaxImports] = useState(true)

  const products = useMemo(
    () =>
      [...byOutput.keys()]
        .filter((id) => meta.data?.tier.get(id) === tier)
        .sort((a, b) => tn(basic(a)?.n, lang).localeCompare(tn(basic(b)?.n, lang))),
    [byOutput, meta.data, tier, lang, basic]
  )
  const chosen = product && byOutput.has(product) ? product : null
  const top = chosen ? byOutput.get(chosen)! : null
  /** One factory of the top tier, units per hour. */
  const perFactory = top ? (top.out[1] * 3600) / (top.t || 3600) : 0
  const rate = rateInput ?? perFactory

  const tree = useMemo(() => {
    if (!chosen || !meta.data) return null
    const build = (type: number, r: number, depth: number): Node => {
      const t = meta.data!.tier.get(type) ?? 0
      const s = byOutput.get(type)
      if (t === 0) return { type, tier: 0, rate: r, source: 'extract', children: [] }
      if (depth > 0 && t <= startTier) return { type, tier: t, rate: r, source: 'buy', children: [] }
      if (!s || depth > 6) return { type, tier: t, rate: r, source: 'buy', children: [] }
      const cyclesPerHour = 3600 / (s.t || 3600)
      return {
        type,
        tier: t,
        rate: r,
        factories: r / (s.out[1] * cyclesPerHour),
        source: 'build',
        children: s.in.map(([id, q]) => build(id, (r / s.out[1]) * q, depth + 1))
      }
    }
    return build(chosen, rate, 0)
  }, [chosen, rate, startTier, meta.data, byOutput])

  // Totals over the tree: what is bought, what is extracted, factories per tier.
  const totals = useMemo(() => {
    const buy = new Map<number, number>()
    const extract = new Map<number, number>()
    const factories = new Map<number, number>()
    const walk = (n: Node) => {
      if (n.source === 'buy') buy.set(n.type, (buy.get(n.type) ?? 0) + n.rate)
      else if (n.source === 'extract') extract.set(n.type, (extract.get(n.type) ?? 0) + n.rate)
      else factories.set(n.tier, (factories.get(n.tier) ?? 0) + (n.factories ?? 0))
      n.children.forEach(walk)
    }
    if (tree) walk(tree)
    return { buy, extract, factories }
  }, [tree])

  const priceIds = chosen ? [chosen, ...totals.buy.keys()] : []
  const prices = useAsync(async () => (priceIds.length ? jitaPrices(priceIds) : null), [priceIds.join(',')])

  if (sde.state === 'downloading' || sde.state === 'building') {
    return <Loading label={`База SDE обновляется для планетарки${sde.progress ? ` — ${Math.round(sde.progress * 100)}%` : ''}…`} />
  }
  if (schematics.loading || meta.loading) return <Loading label="Загружаю схемы планетарки…" />
  if (!Object.keys(schematics.data ?? {}).length) {
    return <Empty>В базе SDE нет схем планетарки. Обновите базу в «Настройках» (раздел SDE).</Empty>
  }

  const price = (id: number, basis: 'sell' | 'buy') => prices.data?.get(id)?.[basis].best ?? 0
  const base = (id: number) => meta.data?.base.get(id) ?? 0
  const revenue = chosen ? rate * price(chosen, sellBasis) : 0
  const buyCost = [...totals.buy].reduce((s, [id, r]) => s + r * price(id, 'sell'), 0)
  const exportTax = chosen ? rate * base(chosen) * (tax / 100) : 0
  const importTax = taxImports ? [...totals.buy].reduce((s, [id, r]) => s + r * base(id) * (tax / 100) * 0.5, 0) : 0
  const profit = revenue - buyCost - exportTax - importTax
  const extracted = [...totals.extract].sort((a, b) => b[1] - a[1])

  return (
    <>
      <Card title="Расчёт планетарки">
        <div className="calc-form">
          <label>
            Уровень продукта
            <select value={tier} onChange={(e) => (setTier(Number(e.target.value)), setProduct(null), setRateInput(null))}>
              {[1, 2, 3, 4].map((t) => (
                <option key={t} value={t}>{`P${t}`}</option>
              ))}
            </select>
          </label>
          <label className="wide">
            Продукт
            <select value={chosen ?? ''} onChange={(e) => (setProduct(Number(e.target.value) || null), setRateInput(null))}>
              <option value="">— выберите —</option>
              {products.map((id) => (
                <option key={id} value={id}>
                  {tn(basic(id)?.n, lang)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Начинать с
            <select value={startTier} onChange={(e) => setStartTier(Number(e.target.value))}>
              <option value={0}>добычи P0</option>
              {[1, 2, 3].filter((t) => t < tier).map((t) => (
                <option key={t} value={t}>{`покупки P${t} в Jita`}</option>
              ))}
            </select>
          </label>
          <label>
            Выход, шт/час
            <input type="number" min={0} step="any" value={Number(rate.toFixed(2))} onChange={(e) => setRateInput(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            Налог таможни, %
            <input type="number" min={0} max={100} step={0.5} value={tax} onChange={(e) => setTax(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            Продажа продукта
            <select value={sellBasis} onChange={(e) => setSellBasis(e.target.value as 'sell' | 'buy')}>
              <option value="sell">ордером (Jita sell)</option>
              <option value="buy">в buy-ордера (Jita buy)</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={taxImports} onChange={(e) => setTaxImports(e.target.checked)} /> Налог на ввоз купленного
          </label>
        </div>
        {top && (
          <p className="muted small">
            {`Одна фабрика: ${fmtNum(top.out[1])} шт за цикл ${fmtNum(top.t / 60)} мин = ${fmtNum(perFactory)} шт/час.`}
          </p>
        )}
      </Card>

      {!chosen ? (
        <Empty>Выберите продукт: калькулятор покажет цепочку, планеты и прибыль.</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Выручка в час" value={fmtIsk(revenue, true)} sub={`${fmtNum(rate)} шт × ${fmtIsk(price(chosen, sellBasis), true)}`} />
            <Stat label="Закупка в час" value={fmtIsk(buyCost, true)} sub={startTier ? `покупка P${startTier} по Jita sell` : 'всё из добычи'} />
            <Stat label="Налоги таможни в час" value={fmtIsk(exportTax + importTax, true)} sub={`вывоз ${fmtIsk(exportTax, true)} · ввоз ${fmtIsk(importTax, true)}`} />
            <Stat
              label="Прибыль"
              value={<span className={profit >= 0 ? 'good' : 'bad'}>{`${fmtIsk(profit, true)} / час`}</span>}
              sub={`${fmtIsk(profit * 24, true)} в сутки`}
            />
          </div>

          <div className="two-col">
            <Card title="Цепочка производства">
              {tree && <TreeView node={tree} depth={0} />}
              <p className="muted small">
                {[...totals.factories]
                  .sort((a, b) => b[0] - a[0])
                  .map(([t, n]) => `P${t}: ${fmtNum(Math.ceil(n - 1e-9))} фабр.`)
                  .join(' · ')}
              </p>
            </Card>
            <div className="stack">
              {extracted.length > 0 && (
                <Card title="Сырьё P0 и планеты">
                  <table className="table compact">
                    <tbody>
                      {extracted.map(([id, r]) => (
                        <tr key={id}>
                          <td>
                            <TypeLink id={id} size={20} />
                          </td>
                          <td className="num">{`${fmtNum(r)} / час`}</td>
                          <td className="muted small">{(P0_PLANETS[id] ?? []).map((p) => PLANET_TYPES[p]).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted small">Сколько даёт экстрактор, зависит от планеты, места и времени цикла — смотрите сканер ресурсов в игре.</p>
                </Card>
              )}
              {totals.buy.size > 0 && (
                <Card title="Закупка в Jita">
                  <table className="table compact">
                    <tbody>
                      {[...totals.buy].map(([id, r]) => (
                        <tr key={id}>
                          <td>
                            <TypeLink id={id} size={20} />
                          </td>
                          <td className="num">{`${fmtNum(r)} / час`}</td>
                          <td className="num">{fmtIsk(r * price(id, 'sell'), true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          </div>
          {extracted.length > 0 && <ColonyFinder resources={extracted.map(([id]) => id)} />}
          <p className="muted small">
            Налог таможни: базовая стоимость единицы из SDE (P0 5, P1 400, P2 7 200, P3 60 000, P4 1 200 000 ISK) × ставка; ввоз — половина вывоза (по EVE University).
            Перевозка промежуточных товаров между вашими планетами не учтена. Схемы — из SDE CCP.
          </p>
        </>
      )}
    </>
  )
}

/** Where to put the colonies: systems near you with planets for every raw resource of the chain. */
function ColonyFinder({ resources }: { resources: number[] }) {
  const [from, setFrom] = useState<{ id: number; name: string } | null>(null)
  const [radius, setRadius] = useState(5)
  const [space, setSpace] = useState<'any' | 'high' | 'low'>('any')
  const needs = resources.map((id) => P0_PLANETS[id] ?? [])
  const sites = useAsync(
    async () => (from ? window.api.sde.colonySites(from.id, radius, needs) : null),
    [from?.id, radius, resources.join(',')]
  )
  const shown = (sites.data ?? []).filter((s) => {
    const sec = roundSec(s.sec)
    return space === 'any' || (space === 'high' ? sec >= 0.5 : sec < 0.5)
  })
  return (
    <Card title="Где ставить колонии">
      <div className="calc-form">
        <label className="wide">
          От системы
          <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setFrom} initial={from?.name ?? ''} />
        </label>
        <label>
          Радиус, прыжков
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {[0, 1, 2, 3, 5, 7, 10].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Безопасность
          <select value={space} onChange={(e) => setSpace(e.target.value as typeof space)}>
            <option value="any">любая</option>
            <option value="high">только хайсек</option>
            <option value="low">лоусек и ниже</option>
          </select>
        </label>
      </div>
      {!from ? (
        <p className="muted small">Укажите систему, от которой искать: покажу системы рядом, где есть планеты под всё сырьё цепочки.</p>
      ) : sites.loading ? (
        <Loading />
      ) : !shown.length ? (
        <Empty>В этом радиусе подходящих систем нет — увеличьте радиус.</Empty>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Система</th>
              <th className="num">Прыжков</th>
              <th>Планеты</th>
              <th>Сырьё</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td>
                  <Sec value={s.sec} /> {s.n}
                </td>
                <td className="num">{s.jumps}</td>
                <td className="small">
                  {Object.entries(s.planets)
                    .filter(([t]) => PLANET_TYPES[Number(t)])
                    .map(([t, n]) => `${PLANET_TYPES[Number(t)]}${n > 1 ? ` ×${n}` : ''}`)
                    .join(', ') || '—'}
                </td>
                <td className="small">
                  {s.missing.length ? (
                    <span className="warn-text">
                      нет:{' '}
                      {s.missing.map((i, k) => (
                        <span key={i}>
                          {k ? ', ' : ''}
                          <TypeName id={resources[i]} />
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="good">✔ всё сырьё</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        Типы планет — из SDE. Планетарка недоступна в некоторых системах (например, торговые хабы вроде Jita) и в разрушенных системах — проверяйте в игре.
      </p>
    </Card>
  )
}

function TreeView({ node, depth }: { node: Node; depth: number }) {
  return (
    <div className="pi-node" style={{ paddingLeft: depth ? 16 : 0 }}>
      <div className="pi-row">
        <TypeLink id={node.type} size={20} />
        <span className="meta-badge">{`P${node.tier}`}</span>
        <span className="muted small">{`${fmtNum(node.rate)} / час`}</span>
        {node.source === 'build' && <span className="small">{`· фабрик ${fmtNum(node.factories ?? 0)}`}</span>}
        {node.source === 'buy' && <span className="small warn-text">· купить</span>}
        {node.source === 'extract' && (
          <span className="small good">{`· добыть: ${(P0_PLANETS[node.type] ?? []).map((p) => PLANET_TYPES[p]).join(', ')}`}</span>
        )}
      </div>
      {node.children.map((c, i) => (
        <TreeView key={`${c.type}-${i}`} node={c} depth={depth + 1} />
      ))}
    </div>
  )
}

