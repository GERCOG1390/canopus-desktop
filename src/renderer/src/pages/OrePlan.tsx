// Ore for minerals: from a list of minerals (pasted, or what an item's blueprint needs), the cheapest mix of
// compressed ore at Jita that covers them after reprocessing, against buying the minerals outright.

import { useState } from 'react'
import { useApp, useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, SearchBox, Stat } from '../components/ui'
import { fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices, parseItemList } from '../lib/market'
import { searchTypesSde } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { planOres, resolveListLines, splitTrailingQty } from '../../../shared/orePlan'

const SAMPLE = 'Tritanium 2000000\nPyerite 500000\nMexallon 100000'

export default function OrePlan() {
  const { sde } = useApp()
  const lang = useLang()
  const [text, setText] = useState(SAMPLE)
  const [refine, setRefine] = useState(70)
  const [runs, setRuns] = useState(1)
  const [fillError, setFillError] = useState<string | null>(null)
  const ores = useAsync(() => window.api.sde.compressedOres(), [sde.state, sde.build])

  const fill = async (id: number) => {
    setFillError(null)
    // The search also finds blueprints themselves: then it's their product that's meant.
    const product = (await window.api.sde.blueprintProducts([id]))[id] ?? id
    const bp = await window.api.sde.blueprintForProduct(product)
    if (!bp?.data.mat?.length) return setFillError('Для этого предмета нет чертежа или формулы реакции')
    // Only what ore refines into; components and the like are not ore's job.
    const minerals = new Set((ores.data ?? []).flatMap((o) => o.yields.map(([m]) => m)))
    const list = bp.data.mat.filter(([m]) => minerals.has(m))
    if (!list.length) return setFillError('Такие минералы рудой не покрыть.')
    const basics = await window.api.sde.basics(list.map(([m]) => m))
    setText(list.map(([m, q]) => `${basics[m]?.n[0] ?? m} ${q * Math.max(1, runs)}`).join('\n'))
  }

  const plan = useAsync(async () => {
    const parsed = parseItemList(text)
    if (!parsed.length || !ores.data) return null
    const names = parsed.flatMap((p) => [p.name, splitTrailingQty(p.name)?.name ?? p.name])
    const ids = await window.api.intel.resolveTypeNames([...new Set(names)])
    const { lines, unknown } = resolveListLines(parsed, (n) => !!ids[n])
    const merged = new Map<number, number>()
    for (const l of lines) merged.set(ids[l.name], (merged.get(ids[l.name]) ?? 0) + l.qty)
    const needs = [...merged].map(([id, qty]) => ({ id, qty }))
    if (!needs.length) return { unknown, needs, result: null, raw: new Map<number, number>() }
    const prices = await jitaPrices([...ores.data.map((o) => o.id), ...needs.map((n) => n.id)])
    const sell = (id: number): number => prices.get(id)?.sell.best ?? 0
    const infos = ores.data.map((o) => ({ ...o, price: sell(o.id) }))
    return {
      unknown,
      needs,
      result: planOres(needs, infos, refine / 100, new Map(needs.map((n) => [n.id, sell(n.id)]))),
      raw: new Map(ores.data.map((o) => [o.id, o.rawVolume]))
    }
  }, [text, refine, ores.data])

  const r = plan.data?.result
  return (
    <>
      <Card title="Какие минералы нужны">
        <div className="calc-form">
          <label className="wide">
            Заполнить из предмета
            <SearchBox placeholder="Rifter, Hobgoblin II…" search={(q) => searchTypesSde(q, lang)} onSelect={(t) => void fill(t.id)} />
          </label>
          <label>
            Прогонов чертежа
            <input type="number" min={1} value={runs} onChange={(e) => setRuns(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            Выход переработки, %
            <input type="number" min={1} max={100} step={0.1} value={refine} onChange={(e) => setRefine(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
        </div>
        {fillError && <p className="warn-text small">{fillError}</p>}
        <textarea rows={6} style={{ width: '100%' }} value={text} onChange={(e) => {
            setText(e.target.value)
            setFillError(null)
          }} />
        {!!plan.data?.unknown.length && <p className="warn-text small">{`Не распознано: ${plan.data.unknown.join(', ')}`}</p>}
      </Card>
      {ores.loading || plan.loading ? (
        <Loading />
      ) : plan.error || ores.error ? (
        <ErrorBox error={plan.error ?? ores.error} />
      ) : !r ? (
        <Empty>Вставьте список минералов или заполните из предмета.</Empty>
      ) : !r.covered ? (
        <Empty>Такие минералы рудой не покрыть.</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Руда обойдётся" value={fmtIsk(r.oreCost, true)} />
            <Stat label="Минералы в Jita" value={fmtIsk(r.mineralCost, true)} />
            <Stat label="Выгода руды" value={<span className={r.mineralCost - r.oreCost >= 0 ? 'good' : 'bad'}>{fmtIsk(r.mineralCost - r.oreCost, true)}</span>} />
          </div>
          <Card title="Сколько купить">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Руда</th>
                  <th className="num">Партий</th>
                  <th className="num">Единиц</th>
                  <th className="num">Объём сжатой, м³</th>
                  <th className="num">Объём несжатой, м³</th>
                  <th className="num">Стоимость</th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <TypeLink id={l.id} size={20} />
                    </td>
                    <td className="num">{fmtNum(l.batches)}</td>
                    <td className="num">{fmtNum(l.units)}</td>
                    <td className="num">{l.volume < 10 ? l.volume.toFixed(1) : fmtNum(Math.round(l.volume))}</td>
                    <td className="num">{fmtNum(Math.round(l.units * (plan.data?.raw.get(l.id) ?? 0)))}</td>
                    <td className="num">{fmtIsk(l.cost, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.surplus.length > 0 && (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Лишнее после округления</th>
                    <th className="num">Единиц</th>
                  </tr>
                </thead>
                <tbody>
                  {r.surplus.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <TypeLink id={s.id} size={20} />
                      </td>
                      <td className="num">{fmtNum(s.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">
              Подбор самой дешёвой смеси сжатой руды по лучшей цене продажи в Jita. Сколько реально даст переработка, зависит от навыков и структуры: укажите свой выход (около 70% на
              станции с навыками, до 90% в Tatara). Для добычи — столько же обычной руды. Побочные минералы, которых нет в списке, в выгоду не входят.
            </p>
          </Card>
        </>
      )}
    </>
  )
}
