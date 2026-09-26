import { useState, type ChangeEvent } from 'react'
import { useApp } from '../AppContext'
import { Card, Empty, ErrorBox, Loading, ProgressBar, RequireLogin, SearchBox, Sec, Stat, Tabs, TypeIcon } from '../components/ui'
import { esi, resolveIds, resolveNames, searchSystems, searchTypes, systemInfo } from '../lib/esi'
import { fmtDate, fmtDuration, fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { useAsync, useTick } from '../lib/useAsync'

type Tab = 'calc' | 'jobs' | 'pi'

export default function IndustryPage() {
  const [tab, setTab] = useState<Tab>('calc')
  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'calc', label: 'Калькулятор производства' },
          { id: 'jobs', label: 'Мои работы' },
          { id: 'pi', label: 'Планетарка' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'calc' && <Calculator />}
      {tab === 'jobs' && <Jobs />}
      {tab === 'pi' && <Planets />}
    </div>
  )
}

// ---------------- Manufacturing calculator ----------------

interface BlueprintData {
  blueprintDetails: {
    productTypeID: number
    productTypeName: string
    productQuantity: number
    maxProductionLimit: number
    times: Record<string, number>
    techLevel: number
  }
  activityMaterials: Record<string, { typeid: number; name: string; quantity: number }[]>
}

const MANUFACTURING = '1'
const REACTION = '11'
/** SCC surcharge added to every industry job. */
const SCC_SURCHARGE = 0.04

async function findBlueprint(product: { id: number; name: string }) {
  const candidates = product.name.endsWith(' Blueprint') || product.name.endsWith(' Reaction Formula')
    ? [product.name]
    : [`${product.name} Blueprint`, `${product.name} Reaction Formula`]
  const ids = await resolveIds(candidates)
  const bp = ids.inventory_types?.[0]
  if (!bp) throw new Error(`Для «${product.name}» не найден чертёж или формула реакции`)
  const data = await window.api.request<BlueprintData>(`https://www.fuzzwork.co.uk/blueprint/api/blueprint.php?typeid=${bp.id}`)
  const activity = data.activityMaterials[MANUFACTURING]?.length ? MANUFACTURING : REACTION
  const materials = data.activityMaterials[activity] ?? []
  if (!materials.length) throw new Error('У чертежа нет данных о материалах')
  return { blueprint: bp, data, activity, materials }
}

function Calculator() {
  const { active } = useApp()
  const [product, setProduct] = useState<{ id: number; name: string } | null>(null)
  const [runs, setRuns] = useState(1)
  const [me, setMe] = useState(10)
  const [te, setTe] = useState(20)
  const [structureBonus, setStructureBonus] = useState(1)
  const [facilityTax, setFacilityTax] = useState(0.25)
  const [salesTax, setSalesTax] = useState(3.37)
  const [priceBasis, setPriceBasis] = useState<'sell' | 'buy'>('sell')
  const [system, setSystem] = useState<{ id: number; name: string }>({ id: 30000142, name: 'Jita' })

  const bp = useAsync(async () => (product ? findBlueprint(product) : null), [product?.id])

  const market = useAsync(async () => {
    if (!bp.data) return null
    const ids = [bp.data.data.blueprintDetails.productTypeID, ...bp.data.materials.map((m) => m.typeid)]
    const [prices, adjusted, indices, sys] = await Promise.all([
      jitaPrices(ids),
      esi<{ type_id: number; adjusted_price?: number }[]>('/markets/prices/'),
      esi<{ solar_system_id: number; cost_indices: { activity: string; cost_index: number }[] }[]>('/industry/systems/'),
      systemInfo(system.id)
    ])
    const adj = new Map(adjusted.map((p) => [p.type_id, p.adjusted_price ?? 0]))
    const activityName = bp.data.activity === REACTION ? 'reaction' : 'manufacturing'
    const costIndex = indices.find((s) => s.solar_system_id === system.id)?.cost_indices.find((c) => c.activity === activityName)?.cost_index ?? 0
    return { prices, adj, costIndex, sys }
  }, [bp.data, system.id])

  const isReaction = bp.data?.activity === REACTION
  const effectiveMe = isReaction ? 0 : me
  const effectiveTe = isReaction ? 0 : te

  let body = <Empty>Выберите предмет, который хотите произвести. Нужен английский вариант названия, как в игре.</Empty>
  if (product && bp.loading) body = <Loading label="Загружаю чертёж…" />
  else if (bp.error) body = <ErrorBox error={bp.error} />
  else if (bp.data && market.loading) body = <Loading label="Загружаю цены и индексы…" />
  else if (market.error) body = <ErrorBox error={market.error} />
  else if (bp.data && market.data) {
    const { data, materials } = bp.data
    const { prices, adj, costIndex, sys } = market.data
    const details = data.blueprintDetails
    const price = (id: number) => (priceBasis === 'sell' ? prices.get(id)?.sell.best : prices.get(id)?.buy.best) ?? 0

    const rows = materials.map((m) => {
      const qty = Math.max(runs, Math.ceil(Number((m.quantity * runs * (1 - effectiveMe / 100) * (1 - structureBonus / 100)).toFixed(2))))
      return { ...m, qty, unit: price(m.typeid), total: qty * price(m.typeid) }
    })
    const materialCost = rows.reduce((s, r) => s + r.total, 0)
    const eiv = materials.reduce((s, m) => s + m.quantity * (adj.get(m.typeid) ?? 0), 0) * runs
    const jobCost = eiv * (costIndex + facilityTax / 100 + SCC_SURCHARGE)
    const outputQty = details.productQuantity * runs
    const productSell = prices.get(details.productTypeID)?.sell.best ?? 0
    const revenue = outputQty * productSell
    const tax = revenue * (salesTax / 100)
    const totalCost = materialCost + jobCost
    const profit = revenue - tax - totalCost
    const activityTime = details.times[bp.data.activity] ?? 0
    const time = activityTime * runs * (1 - effectiveTe / 100)

    body = (
      <>
        <div className="stats-row">
          <Stat label="Себестоимость" value={fmtIsk(totalCost, true)} sub={`за ед. ${fmtIsk(totalCost / outputQty, true)}`} />
          <Stat label={`Продажа ${fmtNum(outputQty)} шт (Jita sell)`} value={fmtIsk(revenue, true)} sub={`налог ${fmtIsk(tax, true)}`} />
          <Stat
            label="Прибыль"
            value={<span className={profit >= 0 ? 'good' : 'bad'}>{fmtIsk(profit, true)}</span>}
            sub={totalCost ? `маржа ${((profit / totalCost) * 100).toFixed(1)}%` : undefined}
          />
          <Stat label="Время" value={fmtDuration(time * 1000)} sub={`${fmtIsk(profit / Math.max(1, time / 3600), true)} в час`} />
        </div>
        <div className="two-col">
          <Card title={`Материалы (${priceBasis === 'sell' ? 'покупка с рынка по sell' : 'через buy-ордера'})`}>
            <table className="table">
              <thead>
                <tr>
                  <th>Материал</th>
                  <th className="num">Кол-во</th>
                  <th className="num">Цена</th>
                  <th className="num">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.typeid}>
                    <td>
                      <TypeIcon typeId={r.typeid} size={20} /> {r.name}
                    </td>
                    <td className="num">{fmtNum(r.qty)}</td>
                    <td className="num">{fmtIsk(r.unit)}</td>
                    <td className="num">{fmtIsk(r.total, true)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={3}>Материалы</td>
                  <td className="num">{fmtIsk(materialCost, true)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
          <Card title="Стоимость работы">
            <table className="table compact">
              <tbody>
                <tr>
                  <td>Система</td>
                  <td className="num">
                    <Sec value={sys.security_status} /> {sys.name}
                  </td>
                </tr>
                <tr>
                  <td>Estimated Item Value</td>
                  <td className="num">{fmtIsk(eiv, true)}</td>
                </tr>
                <tr>
                  <td>Индекс стоимости ({isReaction ? 'реакции' : 'производство'})</td>
                  <td className="num">{(costIndex * 100).toFixed(2)}%</td>
                </tr>
                <tr>
                  <td>Налог сооружения</td>
                  <td className="num">{facilityTax}%</td>
                </tr>
                <tr>
                  <td>Надбавка SCC</td>
                  <td className="num">{SCC_SURCHARGE * 100}%</td>
                </tr>
                <tr className="total">
                  <td>Стоимость установки</td>
                  <td className="num">{fmtIsk(jobCost, true)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">
              Tech {details.techLevel} · выход {details.productQuantity} шт за прогон · макс. прогонов на копии: {details.maxProductionLimit}. Данные чертежей: Fuzzwork SDE.
            </p>
          </Card>
        </div>
      </>
    )
  }

  const num = (set: (n: number) => void, min: number, max: number) => (e: ChangeEvent<HTMLInputElement>) =>
    set(Math.max(min, Math.min(max, Number(e.target.value) || 0)))

  return (
    <>
      <Card>
        <div className="calc-form">
          <label className="wide">
            Продукт
            <SearchBox
              placeholder="Например: Rifter, Hobgoblin II, Fernite Carbide"
              search={(q) => searchTypes(q, active?.id ?? null)}
              onSelect={setProduct}
              renderItem={(t) => (
                <>
                  <TypeIcon typeId={t.id} size={20} /> {t.name}
                </>
              )}
            />
          </label>
          <label>
            Прогонов
            <input type="number" min={1} value={runs} onChange={num(setRuns, 1, 100000)} />
          </label>
          <label>
            ME
            <input type="number" min={0} max={10} value={me} disabled={isReaction} onChange={num(setMe, 0, 10)} />
          </label>
          <label>
            TE
            <input type="number" min={0} max={20} step={2} value={te} disabled={isReaction} onChange={num(setTe, 0, 20)} />
          </label>
          <label>
            Бонус структуры, %
            <input type="number" step={0.1} value={structureBonus} onChange={num(setStructureBonus, 0, 10)} />
          </label>
          <label>
            Налог сооружения, %
            <input type="number" step={0.05} value={facilityTax} onChange={num(setFacilityTax, 0, 50)} />
          </label>
          <label>
            Налог с продаж, %
            <input type="number" step={0.01} value={salesTax} onChange={num(setSalesTax, 0, 10)} />
          </label>
          <label>
            Цены материалов
            <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value as 'sell' | 'buy')}>
              <option value="sell">Jita sell</option>
              <option value="buy">Jita buy</option>
            </select>
          </label>
          <label>
            Система производства
            <SearchBox placeholder="Система…" search={(q) => searchSystems(q, active?.id ?? null)} onSelect={setSystem} initial={system.name} />
          </label>
        </div>
      </Card>
      {body}
    </>
  )
}

// ---------------- Industry jobs ----------------

interface Job {
  job_id: number
  activity_id: number
  blueprint_type_id: number
  product_type_id?: number
  runs: number
  status: string
  start_date: string
  end_date: string
  facility_id: number
  station_id?: number
  cost?: number
}

const ACTIVITY: Record<number, string> = {
  1: 'Производство',
  3: 'Исследование TE',
  4: 'Исследование ME',
  5: 'Копирование',
  8: 'Изобретение',
  9: 'Реакция',
  11: 'Реакция'
}

function Jobs() {
  const { active } = useApp()
  const now = useTick(1000)
  const { data, error, loading, reload } = useAsync(async () => {
    if (!active) return null
    const jobs = await esi<Job[]>(`/characters/${active.id}/industry/jobs/?include_completed=false`, { characterId: active.id })
    const names = await resolveNames(jobs.flatMap((j) => [j.blueprint_type_id, j.product_type_id ?? 0]))
    return { jobs: jobs.sort((a, b) => a.end_date.localeCompare(b.end_date)), names }
  }, [active?.id])

  if (!active) return <RequireLogin what="производственные работы" />
  if (loading) return <Loading />
  if (!data) return <ErrorBox error={error} />

  return (
    <Card
      title={`Активные работы: ${data.jobs.length}`}
      actions={
        <button className="ghost" onClick={reload}>
          Обновить
        </button>
      }
    >
      {!data.jobs.length ? (
        <Empty>Нет активных работ.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Чертёж</th>
              <th>Активность</th>
              <th className="num">Прогонов</th>
              <th>Прогресс</th>
              <th className="num">Осталось</th>
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((j) => {
              const start = new Date(j.start_date).getTime()
              const end = new Date(j.end_date).getTime()
              const left = end - now
              return (
                <tr key={j.job_id}>
                  <td>
                    <TypeIcon typeId={j.blueprint_type_id} size={20} /> {data.names.get(j.blueprint_type_id)}
                  </td>
                  <td>{ACTIVITY[j.activity_id] ?? j.activity_id}</td>
                  <td className="num">{j.runs}</td>
                  <td style={{ minWidth: 140 }}>
                    <ProgressBar value={(now - start) / (end - start)} />
                  </td>
                  <td className={`num ${left <= 0 ? 'good' : ''}`}>{left <= 0 ? 'Готово — заберите!' : fmtDuration(left)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}

// ---------------- Planetary industry ----------------

interface Colony {
  planet_id: number
  planet_type: string
  solar_system_id: number
  upgrade_level: number
  num_pins: number
  last_update: string
}
interface Pin {
  pin_id: number
  type_id: number
  expiry_time?: string
  extractor_details?: { product_type_id?: number; qty_per_cycle?: number; cycle_time?: number }
  schematic_id?: number
}

function Planets() {
  const { active } = useApp()
  const now = useTick(30_000)
  const { data, error, loading, reload } = useAsync(async () => {
    if (!active) return null
    const colonies = await esi<Colony[]>(`/characters/${active.id}/planets/`, { characterId: active.id })
    const details = await Promise.all(
      colonies.map((c) => esi<{ pins: Pin[] }>(`/characters/${active.id}/planets/${c.planet_id}/`, { characterId: active.id }).catch(() => ({ pins: [] as Pin[] })))
    )
    const products = details.flatMap((d) => d.pins.map((p) => p.extractor_details?.product_type_id ?? 0))
    const names = await resolveNames([...colonies.map((c) => c.planet_id), ...products])
    const systems = await Promise.all(colonies.map((c) => systemInfo(c.solar_system_id)))
    return colonies.map((c, i) => {
      const extractors = details[i].pins.filter((p) => p.extractor_details)
      const expiries = extractors.map((p) => (p.expiry_time ? new Date(p.expiry_time).getTime() : 0))
      return {
        ...c,
        name: names.get(c.planet_id) ?? String(c.planet_id),
        system: systems[i],
        extractors,
        products: [...new Set(extractors.map((p) => names.get(p.extractor_details?.product_type_id ?? 0)).filter(Boolean))],
        expiry: expiries.length ? Math.min(...expiries) : null,
        factories: details[i].pins.filter((p) => p.schematic_id).length
      }
    })
  }, [active?.id])

  if (!active) return <RequireLogin what="колонии" />
  if (loading) return <Loading />
  if (!data) return <ErrorBox error={error} />
  const sorted = [...data].sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity))
  const expired = sorted.filter((c) => c.expiry !== null && c.expiry <= now).length

  return (
    <>
      <div className="stats-row">
        <Stat label="Колоний" value={data.length} />
        <Stat label="Экстракторы остановлены" value={<span className={expired ? 'bad' : 'good'}>{expired}</span>} />
      </div>
      <Card
        actions={
          <button className="ghost" onClick={reload}>
            Обновить
          </button>
        }
      >
        {!data.length ? (
          <Empty>Колоний нет.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Планета</th>
                <th>Тип</th>
                <th>Добыча</th>
                <th className="num">Фабрик</th>
                <th className="num">Экстракторы до</th>
                <th className="num">Осталось</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const left = c.expiry === null ? null : c.expiry - now
                return (
                  <tr key={c.planet_id}>
                    <td>
                      <Sec value={c.system.security_status} /> {c.name}
                    </td>
                    <td className="muted">{c.planet_type}</td>
                    <td>{c.products.join(', ') || <span className="muted">—</span>}</td>
                    <td className="num">{c.factories}</td>
                    <td className="num muted">{c.expiry ? fmtDate(new Date(c.expiry).toISOString()) : '—'}</td>
                    <td className={`num ${left !== null && left <= 0 ? 'bad' : left !== null && left < 6 * 3600_000 ? 'warn-text' : ''}`}>
                      {left === null ? '—' : left <= 0 ? 'Остановлены' : fmtDuration(left)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">ESI обновляет данные колонии только когда вы открываете её в игре.</p>
      </Card>
    </>
  )
}
