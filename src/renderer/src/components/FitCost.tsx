import type { FitSpec } from '../../../shared/fit'
import { fmtIsk } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { getBasic } from '../lib/sde'
import { useAsync } from '../lib/useAsync'

interface CostLine {
  label: string
  isk: number
  /** Items without a Jita sell order */
  missing: number
}

/**
 * The fit's price at the best Jita 4-4 sell orders: hull, modules (rigs and subsystems included),
 * a full load of charges in each module, drones and implants.
 */
/** The fit's items with quantities (a full load of charges per module) and their Jita prices. */
export async function fitCost(fit: FitSpec): Promise<{ lines: CostLine[]; total: number; missing: number; items: [number, number][] }> {
  const chargeHolders = fit.modules.filter((m) => m.chargeTypeId)
  const ids = [fit.shipTypeId, ...fit.modules.map((m) => m.typeId), ...chargeHolders.map((m) => m.chargeTypeId!), ...fit.drones.map((d) => d.typeId), ...fit.implants]
  const [prices, basics] = await Promise.all([
    jitaPrices([...new Set(ids)]),
    window.api.sde.basics([...new Set(chargeHolders.flatMap((m) => [m.typeId, m.chargeTypeId!]))])
  ])
  const line = (label: string, items: [number, number][]): CostLine => {
    let isk = 0
    let missing = 0
    for (const [id, qty] of items) {
      const p = prices.get(id)?.sell.best
      if (p) isk += p * qty
      else if (qty > 0) missing++
    }
    return { label, isk, missing }
  }
  // A full load: as many charges as fit into the module's capacity.
  const loads: [number, number][] = chargeHolders.map((m) => {
    const cap = basics[m.typeId]?.cap ?? 0
    const vol = basics[m.chargeTypeId!]?.v ?? getBasic(m.chargeTypeId!)?.v ?? 0
    return [m.chargeTypeId!, cap > 0 && vol > 0 ? Math.floor(cap / vol + 1e-9) : 1]
  })
  const groups: [string, [number, number][]][] = [
    ['Корабль', [[fit.shipTypeId, 1]]],
    ['Модули', fit.modules.map((m) => [m.typeId, 1])],
    ['Заряды', loads],
    ['Дроны', fit.drones.map((d) => [d.typeId, d.count])],
    ['Импланты', fit.implants.map((i) => [i, 1])]
  ]
  const lines = groups.map(([label, items]) => line(label, items)).filter((l) => l.isk > 0 || l.missing > 0)
  return { lines, total: lines.reduce((s, l) => s + l.isk, 0), missing: lines.reduce((s, l) => s + l.missing, 0), items: groups.flatMap(([, items]) => items) }
}

export function FitCost({ fit }: { fit: FitSpec }) {
  const key = JSON.stringify([fit.shipTypeId, fit.modules.map((m) => [m.typeId, m.chargeTypeId ?? 0]), fit.drones.map((d) => [d.typeId, d.count]), fit.implants])
  const cost = useAsync(() => fitCost(fit), [key])

  return (
    <section>
      <h4>Стоимость (Jita, продажа)</h4>
      {cost.loading && !cost.data ? (
        <p className="muted small">Загружаю цены…</p>
      ) : cost.data ? (
        <>
          <div className="big-stats">
            <div>
              <b>{fmtIsk(cost.data.total, true)}</b>
            </div>
          </div>
          <div className="kv-list">
            {cost.data.lines.map((l) => (
              <FitCostRow key={l.label} line={l} />
            ))}
          </div>
          {cost.data.missing > 0 && <p className="muted small">{`Без ордеров на продажу в Jita: ${cost.data.missing} — не учтены.`}</p>}
        </>
      ) : (
        <p className="muted small">{`Цены недоступны: ${cost.error}`}</p>
      )}
    </section>
  )
}

function FitCostRow({ line }: { line: CostLine }) {
  return (
    <>
      <span>{line.label}</span>
      <b>{fmtIsk(line.isk, true)}</b>
    </>
  )
}
