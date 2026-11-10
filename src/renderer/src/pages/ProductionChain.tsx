// The whole chain of an item: components to run, materials to buy, and whether any of it beats the market.
// Build or buy is picked per component by price and can be overruled by hand.

import { useMemo, useState, type ChangeEvent } from 'react'
import { useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, SearchBox, Stat } from '../components/ui'
import { esi, systemInfo } from '../lib/esi'
import { fmtDuration, fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { searchSystemsSde, searchTypesSde } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { planChain, type Decision } from '../../../shared/prodChain'

const SCC_SURCHARGE = 0.04

export default function ProductionChain() {
  const lang = useLang()
  const [item, setItem] = useState<{ id: number; name: string } | null>(null)
  const [runs, setRuns] = useState(1)
  const [rootMe, setRootMe] = useState(10)
  const [compMe, setCompMe] = useState(10)
  const [te, setTe] = useState(20)
  const [structure, setStructure] = useState(1)
  const [tax, setTax] = useState(0.25)
  const [system, setSystem] = useState<{ id: number; name: string }>({ id: 30000142, name: 'Jita' })
  const [overrides, setOverrides] = useState<Map<number, Decision>>(new Map())
  const [copied, setCopied] = useState(false)

  const choose = async (t: { id: number; name: string }) => {
    // The search also finds blueprints themselves: then it's their product that's meant.
    const product = (await window.api.sde.blueprintProducts([t.id]))[t.id]
    setOverrides(new Map())
    // An invented blueprint starts at ME 2 / TE 4.
    const invented = (await window.api.sde.inventableTypes()).includes(product ?? t.id)
    setRootMe(invented ? 2 : 10)
    setTe(invented ? 4 : 20)
    setItem(product ? { id: product, name: t.name } : t)
  }

  const data = useAsync(async () => {
    if (!item) return null
    const recipes = await window.api.sde.productionRecipes(item.id)
    if (!recipes[item.id]) return { recipes, prices: null, adjusted: new Map<number, number>() }
    const ids = new Set<number>()
    for (const r of Object.values(recipes)) {
      ids.add(r.product)
      for (const [m] of r.mats) ids.add(m)
    }
    const [prices, adjustedList] = await Promise.all([jitaPrices([...ids]), esi<{ type_id: number; adjusted_price?: number }[]>('/markets/prices/')])
    return { recipes, prices, adjusted: new Map(adjustedList.map((p) => [p.type_id, p.adjusted_price ?? 0])) }
  }, [item?.id])

  const indices = useAsync(async () => {
    const [list, sys] = await Promise.all([esi<{ solar_system_id: number; cost_indices: { activity: string; cost_index: number }[] }[]>('/industry/systems/'), systemInfo(system.id)])
    const here = list.find((s) => s.solar_system_id === system.id)?.cost_indices ?? []
    const index = (a: string): number => here.find((c) => c.activity === a)?.cost_index ?? 0
    return { manufacturing: index('manufacturing'), reaction: index('reaction'), sys }
  }, [system.id])

  const plan = useMemo(() => {
    if (!item || !data.data?.prices || !indices.data) return null
    const { recipes, prices, adjusted } = data.data
    const rate = (index: number): number => index + tax / 100 + SCC_SURCHARGE
    return planChain({
      root: item.id,
      runs,
      recipes,
      price: (id) => prices.get(id)?.sell.best ?? 0,
      adjusted: (id) => adjusted.get(id) ?? 0,
      options: { rootMe, compMe, structure, te, rate: { manufacturing: rate(indices.data.manufacturing), reaction: rate(indices.data.reaction) } },
      overrides
    })
  }, [item, data.data, indices.data, runs, rootMe, compMe, te, structure, tax, overrides])

  const set = (id: number, d: Decision) => setOverrides((m) => new Map(m).set(id, d))
  const num = (fn: (n: number) => void, min: number, max: number) => (e: ChangeEvent<HTMLInputElement>) => fn(Math.max(min, Math.min(max, Number(e.target.value) || 0)))

  const copyList = async () => {
    if (!plan) return
    const basics = await window.api.sde.basics(plan.buys.map((b) => b.id))
    await navigator.clipboard.writeText(plan.buys.map((b) => `${basics[b.id]?.n[0] ?? b.id} x${b.qty}`).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const saving = plan ? plan.marketCost - plan.total : 0
  return (
    <>
      <Card>
        <div className="calc-form">
          <label className="wide">
            Предмет
            <SearchBox placeholder="Например: Rifter, Hobgoblin II, Fernite Carbide" search={(q) => searchTypesSde(q, lang)} onSelect={(t) => void choose(t)} initial={item?.name ?? ''} />
          </label>
          <label>
            Прогонов
            <input type="number" min={1} value={runs} onChange={num(setRuns, 1, 100000)} />
          </label>
          <label>
            ME чертежа, %
            <input type="number" min={0} max={10} value={rootMe} onChange={num(setRootMe, 0, 10)} />
          </label>
          <label>
            ME компонентов, %
            <input type="number" min={0} max={10} value={compMe} onChange={num(setCompMe, 0, 10)} />
          </label>
          <label>
            TE, %
            <input type="number" min={0} max={20} value={te} onChange={num(setTe, 0, 20)} />
          </label>
          <label>
            Бонус сооружения, %
            <input type="number" min={0} max={10} step={0.1} value={structure} onChange={num(setStructure, 0, 10)} />
          </label>
          <label>
            Налог сооружения, %
            <input type="number" min={0} max={50} step={0.05} value={tax} onChange={num(setTax, 0, 50)} />
          </label>
          <label>
            Система
            <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setSystem} initial={system.name} />
          </label>
        </div>
      </Card>
      {!item ? (
        <Empty
          icon="industry"
          actions={['Rifter', 'Hobgoblin II', 'Fernite Carbide'].map((name) => (
            <button
              key={name}
              className="ghost small"
              translate="no"
              onClick={() =>
                void searchTypesSde(name, lang).then((found) => {
                  const hit = found.find((t) => t.name === name) ?? found[0]
                  if (hit) void choose(hit)
                })
              }
            >
              {name}
            </button>
          ))}
        >
          Выберите предмет, чтобы увидеть всю цепочку: что запускать и что покупать.
        </Empty>
      ) : data.loading || indices.loading ? (
        <Loading />
      ) : data.error || indices.error ? (
        <ErrorBox error={data.error ?? indices.error} />
      ) : !plan ? (
        <Empty>Для этого предмета нет чертежа или формулы реакции</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Себестоимость" value={fmtIsk(plan.total, true)} sub={`материалы ${fmtIsk(plan.materialCost, true)} · работы ${fmtIsk(plan.jobCost, true)}`} />
            <Stat label="Готовое в Jita" value={plan.marketCost > 0 ? fmtIsk(plan.marketCost, true) : '—'} sub={`${fmtNum(plan.made)} шт.`} />
            {plan.marketCost > 0 && <Stat label="Выгода цепочки" value={<span className={saving >= 0 ? 'good' : 'bad'}>{fmtIsk(saving, true)}</span>} />}
            {plan.surplusValue > 0 && <Stat label="Лишнее из партий" value={fmtIsk(plan.surplusValue, true)} sub="в Jita, в выгоду не входит" />}
            <Stat label="Время подряд" value={fmtDuration(plan.time * 1000)} sub={`работ: ${plan.jobs.length}`} />
          </div>
          {plan.unpriced.length > 0 && <p className="warn-text small">{`Нет цены на рынке, в сумму не вошло: ${plan.unpriced.length}`}</p>}
          <Card title="Что запускать">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Предмет</th>
                  <th className="num">Прогонов</th>
                  <th className="num">На выходе</th>
                  <th className="num">Лишнее</th>
                  <th className="num">Работа</th>
                  <th className="num">Время</th>
                  <th className="num">Собрать, за шт.</th>
                  <th className="num">В Jita, за шт.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <TypeLink id={j.id} size={20} />
                    </td>
                    <td className="num">{fmtNum(j.runs)}</td>
                    <td className="num">{fmtNum(j.made)}</td>
                    <td className="num">{j.surplus ? fmtNum(j.surplus) : '—'}</td>
                    <td className="num">{fmtIsk(j.jobCost, true)}</td>
                    <td className="num">{fmtDuration(j.time * 1000)}</td>
                    <td className="num">{fmtIsk(j.buildUnit, true)}</td>
                    <td className="num">{j.marketUnit > 0 ? fmtIsk(j.marketUnit, true) : '—'}</td>
                    <td className="num">
                      {j.id !== item.id && (
                        <button className="ghost small" onClick={() => set(j.id, 'buy')}>
                          Купить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Что купить">
            <button className="ghost small" onClick={() => void copyList()}>
              {copied ? 'Скопировано' : 'Скопировать для мультибая'}
            </button>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Предмет</th>
                  <th className="num">Кол-во</th>
                  <th className="num">Цена</th>
                  <th className="num">Сумма</th>
                  <th className="num">Собрать, за шт.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.buys.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <TypeLink id={b.id} size={20} />
                    </td>
                    <td className="num">{fmtNum(b.qty)}</td>
                    <td className="num">{b.unit > 0 ? fmtIsk(b.unit) : '—'}</td>
                    <td className="num">{fmtIsk(b.total, true)}</td>
                    <td className="num">{b.buildUnit != null ? fmtIsk(b.buildUnit, true) : ''}</td>
                    <td className="num">
                      {b.buildUnit != null && (
                        <button className="ghost small" onClick={() => set(b.id, 'build')}>
                          Собрать
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overrides.size > 0 && (
              <button className="ghost small" onClick={() => setOverrides(new Map())}>
                Вернуть выбор по цене
              </button>
            )}
            <p className="muted small">
              Купить или собрать выбирается по цене: компонент собирается, если нужное число целых партий дешевле, чем нужное количество по лучшей цене продажи в Jita. Материалы со всех
              уровней складываются до округления, поэтому общий компонент — это одна работа. Считается одна работа на компонент: если её придётся делить на несколько копий чертежа,
              материалов уйдёт немного больше. Для T2 чертёж после инвенции обычно ME 2, а стоимость самой инвенции сюда не входит: её считает вкладка «Инвенция». Навыки и бонусы на время здесь не учитываются.
            </p>
          </Card>
        </>
      )}
    </>
  )
}
