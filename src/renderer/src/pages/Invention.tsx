// Invention: pick a T2 item, see the chance from the pilot's skills, and every decryptor compared by what a
// blueprint comes to once the failed attempts are paid for, with the most profitable one marked.

import { ACCOUNTING_ID, BROKER_RELATIONS_ID } from '../lib/skillIds'
import { brokerPct, salesTaxPct } from '../../../shared/industryRules'
import { useEffect, useMemo, useState } from 'react'
import { useApp, useLang } from '../AppContext'
import { useCharacter } from '../CharacterContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, SearchBox, Stat } from '../components/ui'
import { esi } from '../lib/esi'
import { fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { searchSystemsSde, searchTypesSde } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { inventionRun, type InventionInput } from '../../../shared/invention'

/** SCC surcharge added to every industry job. */
const SCC_SURCHARGE = 0.04
/** An invention job's base: this share of the item's estimated value. */
const INVENTION_JOB_SHARE = 0.02

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

const RELIC_CATEGORY = 34

export default function Invention() {
  const { sde } = useApp()
  const lang = useLang()
  const char = useCharacter()
  const [product, setProduct] = useState<{ id: number; name: string } | null>(null)
  const [sourceIdx, setSourceIdx] = useState(0)
  const [levels, setLevels] = useState<Record<number, number>>({})
  const [copyCost, setCopyCost] = useState(0)
  const [structureBonus, setStructureBonus] = useState(1)
  const [facilityTax, setFacilityTax] = useState(0.25)
  const [salesTax, setSalesTax] = useState(3.37)
  const [broker, setBroker] = useState(1.5)
  useEffect(() => {
    if (!char.skills) return
    setSalesTax(Number(salesTaxPct(char.skills.get(ACCOUNTING_ID)?.active ?? 0).toFixed(2)))
    setBroker(Number(brokerPct(char.skills.get(BROKER_RELATIONS_ID)?.active ?? 0).toFixed(2)))
  }, [char.skills])
  const [system, setSystem] = useState<{ id: number; name: string }>({ id: 30000142, name: 'Jita' })

  const inventable = useAsync(() => window.api.sde.inventableTypes(), [sde.state, sde.build])
  const set = useMemo(() => new Set(inventable.data ?? []), [inventable.data])
  const data = useAsync(async () => (product ? window.api.sde.inventionFor(product.id) : null), [product?.id, sde.build])
  const source = data.data?.sources[sourceIdx] ?? data.data?.sources[0]

  useEffect(() => {
    setSourceIdx(0)
    setLevels({})
  }, [product?.id])

  const market = useAsync(async () => {
    const d = data.data
    if (!d || !source) return null
    const ids = [d.product, source.source, ...d.materials.map(([id]) => id), ...source.materials.map(([id]) => id), ...d.decryptors.map((x) => x.id)]
    const [prices, adjusted, indices, basics] = await Promise.all([
      jitaPrices(ids),
      esi<{ type_id: number; adjusted_price?: number }[]>('/markets/prices/'),
      esi<{ solar_system_id: number; cost_indices: { activity: string; cost_index: number }[] }[]>('/industry/systems/'),
      window.api.sde.basics([source.source])
    ])
    // T3: the source is a relic, bought and burnt on every attempt. T2: a copy of a blueprint, whose price is the pilot's own.
    const relic = basics[source.source]?.c === RELIC_CATEGORY ? (prices.get(source.source)?.sell.best ?? 0) : null
    const adj = new Map(adjusted.map((p) => [p.type_id, p.adjusted_price ?? 0]))
    const index = (activity: string) => indices.find((s) => s.solar_system_id === system.id)?.cost_indices.find((c) => c.activity === activity)?.cost_index ?? 0
    return { prices, adj, relic, manufacturing: index('manufacturing'), invention: index('invention') }
  }, [data.data, source?.source, system.id])

  const level = (skill: number): number => levels[skill] ?? (char.skills ? (char.skills.get(skill)?.active ?? 0) : 5)

  const form = (
    <Card title="Инвенция">
      <div className="calc-form">
        <label className="wide">
          Что изобретаем
          <SearchBox
            placeholder="Hobgoblin II, Ishtar…"
            search={async (q) => (await searchTypesSde(q, lang)).filter((t) => set.has(t.id))}
            onSelect={setProduct}
          />
        </label>
        <label className="wide">
          Система
          <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setSystem} initial={system.name} />
        </label>
        <label>
          {market.data?.relic !== null && market.data?.relic !== undefined ? `Реликт за попытку (0 — по Jita: ${fmtIsk(market.data.relic, true)})` : 'Копия T1, ISK за попытку'}
          <input type="number" min={0} value={copyCost} onChange={(e) => setCopyCost(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label>
          Бонус структуры, %
          <input type="number" min={0} step={0.1} value={structureBonus} onChange={(e) => setStructureBonus(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label>
          Налог сооружения, %
          <input type="number" min={0} step={0.01} value={facilityTax} onChange={(e) => setFacilityTax(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label>
          Налог с продаж, %
          <input type="number" min={0} step={0.01} value={salesTax} onChange={(e) => setSalesTax(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label>
          Брокерская, %
          <input type="number" min={0} step={0.01} value={broker} onChange={(e) => setBroker(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>
    </Card>
  )

  if (!product) return (
    <>
      {form}
      <Empty>Выберите T2-предмет: калькулятор покажет шанс, себестоимость и лучший декриптор.</Empty>
    </>
  )
  if (data.loading) return <>{form}<Loading /></>
  if (data.error || !data.data || !source) return <>{form}<ErrorBox error={data.error ?? 'Этот предмет не изобретается'} /></>
  const d = data.data

  let results = market.loading ? <Loading label="Загружаю цены и индексы…" /> : market.error ? <ErrorBox error={market.error} /> : null
  if (!results && market.data) {
    const { prices, adj, manufacturing, invention } = market.data
    const sell = (id: number): number => prices.get(id)?.sell.best ?? 0
    const eivPerRun = d.materials.reduce((s, [id, q]) => s + q * (adj.get(id) ?? 0), 0)
    const tax = facilityTax / 100 + SCC_SURCHARGE
    const datacores = source.materials.reduce((s, [id, q]) => s + q * sell(id), 0)
    const input: InventionInput = {
      baseChance: source.baseChance,
      sci1: level(source.sciences[0]),
      sci2: level(source.sciences[1]),
      enc: level(source.encryption),
      inventionMaterialCost: datacores,
      copyCost: market.data.relic !== null && copyCost === 0 ? market.data.relic : copyCost,
      inventionJobCost: eivPerRun * INVENTION_JOB_SHARE * (invention + tax),
      baseRuns: source.baseRuns,
      unitsPerRun: d.unitsPerRun,
      materials: d.materials.map(([id, quantity]) => ({ quantity, price: sell(id) })),
      eivPerRun,
      costIndex: manufacturing,
      taxRate: tax,
      structureBonus,
      productPrice: sell(d.product),
      salesTax: (salesTax + broker) / 100
    }
    const rows = [
      { id: 0, run: inventionRun(input, null) },
      ...d.decryptors.map((x) => ({ id: x.id, run: inventionRun(input, { price: sell(x.id), chance: x.chance, me: x.me, te: x.te, runs: x.runs }) }))
    ]
    // Per unit: blueprints differ in runs, so a bigger blueprint isn't a better one.
    const perUnit = (r: (typeof rows)[number]) => (r.run.units ? r.run.profit / r.run.units : -Infinity)
    const best = rows.reduce((a, b) => (perUnit(b) > perUnit(a) ? b : a))
    results = (
      <>
        <div className="stats-row">
          <Stat label="Шанс" value={pct(rows[0].run.chance)} sub={`база ${pct(source.baseChance)}`} />
          <Stat label="Датакоры на попытку" value={fmtIsk(datacores, true)} />
          <Stat label="Цена продажи" value={fmtIsk(sell(d.product), true)} sub={`${d.unitsPerRun} шт за прогон`} />
          <Stat label="Лучший выбор" value={<span className={best.run.profit >= 0 ? 'good' : 'bad'}>{fmtIsk(best.run.profit, true)}</span>} sub={best.id ? <TypeLink id={best.id} size={16} /> : 'Без декриптора'} />
        </div>
        <Card title="Сравнение декрипторов">
          <table className="table compact">
            <thead>
              <tr>
                <th>Декриптор</th>
                <th className="num">Шанс</th>
                <th className="num">ME / TE</th>
                <th className="num">Прогонов</th>
                <th className="num">Инвенция на чертёж</th>
                <th className="num">Материалы</th>
                <th className="num">Работа</th>
                <th className="num">Себестоимость за шт</th>
                <th className="num">Прибыль с чертежа</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, run }) => (
                <tr key={id} className={id === best.id ? 'trial-changed' : ''}>
                  <td>{id ? <TypeLink id={id} size={20} /> : 'Без декриптора'}</td>
                  <td className="num">{pct(run.chance)}</td>
                  <td className="num">{`${run.me} / ${run.te}`}</td>
                  <td className="num">{run.runs}</td>
                  <td className="num">{fmtIsk(run.inventionCost, true)}</td>
                  <td className="num">{fmtIsk(run.materialCost, true)}</td>
                  <td className="num">{fmtIsk(run.jobCost, true)}</td>
                  <td className="num">{fmtIsk(run.costPerUnit, true)}</td>
                  <td className={`num ${run.profit >= 0 ? 'good' : 'bad'}`}>{fmtIsk(run.profit, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Прибыль считается по Jita sell, с учётом неудачных попыток: расход на попытку делится на шанс. Стоимость работы инвенции приблизительная (2% стоимости предмета по EVE
            University), время и навыки ускорения не учтены.
          </p>
        </Card>
      </>
    )
  }

  return (
    <>
      {form}
      <Card title="Навыки изобретения">
        {d.sources.length > 1 && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <span className="muted small">Источник</span>
            {d.sources.map((x, i) => (
              <button key={x.source} className={`chip-btn small ${x.source === source.source ? 'active' : ''}`} onClick={() => setSourceIdx(i)}>
                <TypeLink id={x.source} size={16} />
              </button>
            ))}
          </div>
        )}
        <div className="calc-form">
          {[...source.sciences, source.encryption].map((skill) => (
            <label key={skill}>
              <TypeLink id={skill} size={16} />
              <select value={level(skill)} onChange={(e) => setLevels((x) => ({ ...x, [skill]: Number(e.target.value) }))}>
                {[0, 1, 2, 3, 4, 5].map((l) => (
                  <option key={l} value={l}>
                    {fmtNum(l)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Card>
      {results}
    </>
  )
}
