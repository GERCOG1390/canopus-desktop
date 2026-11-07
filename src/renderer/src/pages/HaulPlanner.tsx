// Hauling a list of items: trips by hold and by ISK at risk, the route's danger, time, and a courier's price.

import { useEffect, useRef, useState } from 'react'
import { useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, SearchBox, Sec, Stat } from '../components/ui'
import { fmtDuration, fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices, parseItemList } from '../lib/market'
import { routeDanger, type SystemDanger } from '../lib/routeSafety'
import { searchSystemsSde, searchTypesSde } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { courierCost, haulSeconds, planHaul } from '../../../shared/haulPlan'
import { resolveListLines, splitTrailingQty } from '../../../shared/orePlan'

type Place = { id: number; name: string }
const JITA: Place = { id: 30000142, name: 'Jita' }
const AMARR: Place = { id: 30002187, name: 'Amarr' }

export default function HaulPlanner() {
  const lang = useLang()
  const [text, setText] = useState('')
  const [from, setFrom] = useState<Place>(JITA)
  const [to, setTo] = useState<Place>(AMARR)
  const [flag, setFlag] = useState<'secure' | 'shortest'>('secure')
  const [capacity, setCapacity] = useState(5000)
  const [maxM, setMaxM] = useState(0)
  const [perJump, setPerJump] = useState(45)
  const [rate, setRate] = useState(1000)
  const [collateral, setCollateral] = useState(1)
  const [danger, setDanger] = useState<SystemDanger[] | null>(null)
  const [checking, setChecking] = useState(false)
  const run = useRef(0)
  useEffect(
    () => () => {
      run.current++
    },
    []
  )

  const pickShip = async (t: { id: number }) => {
    const info = await window.api.sde.haulVolumes([t.id])
    if (info[t.id]?.cap) setCapacity(Math.round(info[t.id].cap))
  }

  const items = useAsync(async () => {
    const parsed = parseItemList(text)
    if (!parsed.length) return null
    const names = parsed.flatMap((p) => [p.name, splitTrailingQty(p.name)?.name ?? p.name])
    const ids = await window.api.intel.resolveTypeNames([...new Set(names)])
    const { lines, unknown } = resolveListLines(parsed, (n) => !!ids[n])
    const merged = new Map<number, number>()
    for (const l of lines) merged.set(ids[l.name], (merged.get(ids[l.name]) ?? 0) + l.qty)
    const typeIds = [...merged.keys()]
    const [prices, volumes] = await Promise.all([jitaPrices(typeIds), window.api.sde.haulVolumes(typeIds)])
    return {
      unknown,
      list: typeIds.map((id) => ({ id, qty: merged.get(id) ?? 0, volume: volumes[id]?.vol ?? 0, unit: prices.get(id)?.sell.best ?? 0 }))
    }
  }, [text])

  const route = useAsync(() => window.api.sde.routeLocal(from.id, to.id, flag, []), [from.id, to.id, flag])
  const jumps = route.data ? Math.max(0, route.data.ids.length - 1) : null
  useEffect(() => {
    run.current++
    setDanger(null)
    setChecking(false)
  }, [from.id, to.id, flag])

  const check = () => {
    if (!route.data) return
    const me = ++run.current
    const found: SystemDanger[] = []
    setDanger([])
    setChecking(true)
    void routeDanger(
      route.data.ids,
      (d) => {
        if (run.current !== me) return
        found.push(d)
        setDanger([...found])
      },
      () => run.current !== me
    ).finally(() => {
      if (run.current === me) setChecking(false)
    })
  }

  const plan = items.data ? planHaul(items.data.list, capacity, maxM * 1e6) : null
  const unpriced = items.data?.list.filter((i) => i.unit <= 0).length ?? 0
  const hot = (danger ?? []).filter((d) => d.camps.length || d.smartbombs || d.bubbles || d.kills.length)

  return (
    <>
      <Card title="Что и куда">
        <textarea rows={6} style={{ width: '100%' }} placeholder="Tritanium 2000000&#10;Drake x 3" value={text} onChange={(e) => setText(e.target.value)} />
        {!!items.data?.unknown.length && <p className="warn-text small">{`Не распознано: ${items.data.unknown.join(', ')}`}</p>}
        <div className="calc-form">
          <label>
            Откуда
            <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setFrom} initial={from.name} />
          </label>
          <label>
            Куда
            <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setTo} initial={to.name} />
          </label>
          <label>
            Маршрут
            <select value={flag} onChange={(e) => setFlag(e.target.value as typeof flag)}>
              <option value="secure">Безопасный</option>
              <option value="shortest">Короткий</option>
            </select>
          </label>
          <label className="wide">
            Корабль (подставит трюм)
            <SearchBox placeholder="Например: Bustard, Charon" search={(q) => searchTypesSde(q, lang, { categories: [6] })} onSelect={(t) => void pickShip(t)} />
          </label>
          <label>
            Трюм, м³
            <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            ISK за рейс не больше, млн (0 — без предела)
            <input type="number" min={0} value={maxM} onChange={(e) => setMaxM(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            Секунд на прыжок
            <input type="number" min={1} value={perJump} onChange={(e) => setPerJump(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            Курьер, ISK за м³
            <input type="number" min={0} value={rate} onChange={(e) => setRate(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            Курьер, % от залога
            <input type="number" min={0} step={0.1} value={collateral} onChange={(e) => setCollateral(Math.max(0, Number(e.target.value) || 0))} />
          </label>
        </div>
      </Card>
      {items.loading ? (
        <Loading />
      ) : items.error ? (
        <ErrorBox error={items.error} />
      ) : !plan ? (
        <Empty>Вставьте список предметов: копию из игры, «Название 100» или «Название x 100».</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Рейсов" value={fmtNum(plan.trips.length)} sub={jumps !== null ? `прыжков в одну сторону: ${jumps}` : undefined} />
            <Stat label="Объём" value={`${fmtNum(Math.ceil(plan.volume))} м³`} />
            <Stat label="Стоимость в Jita" value={fmtIsk(plan.value, true)} sub={unpriced ? `без цены: ${unpriced}` : undefined} />
            {jumps !== null && <Stat label="Время" value={fmtDuration(haulSeconds(jumps, plan.trips.length, perJump) * 1000)} sub="туда и обратно, кроме последнего" />}
            <Stat label="Курьер" value={fmtIsk(courierCost(plan.volume, plan.value, rate, collateral), true)} />
          </div>
          {plan.unfit.length > 0 && (
            <Card title="Не влезет в этот трюм">
              <table className="table compact">
                <tbody>
                  {plan.unfit.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <TypeLink id={i.id} size={20} />
                      </td>
                      <td className="num">{`${fmtNum(i.volume)} м³`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Card title="Рейсы">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Рейс</th>
                  <th>Груз</th>
                  <th className="num">Объём</th>
                  <th className="num">Стоимость</th>
                </tr>
              </thead>
              <tbody>
                {plan.trips.slice(0, 100).map((t, n) => (
                  <tr key={n}>
                    <td>{n + 1}</td>
                    <td>
                      {t.lines.map((l) => (
                        <div key={l.id}>
                          <TypeLink id={l.id} size={20} /> <span className="muted small">{`×${fmtNum(l.qty)}`}</span>
                        </div>
                      ))}
                      {t.overLimit && <div className="warn-text small">Один предмет дороже предела: идёт отдельным рейсом</div>}
                    </td>
                    <td className="num">{`${fmtNum(Math.ceil(t.volume))} м³`}</td>
                    <td className="num">{fmtIsk(t.value, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.trips.length > 100 && <p className="muted small">{`Показаны первые 100 рейсов из ${fmtNum(plan.trips.length)}`}</p>}
          </Card>
        </>
      )}
      <Card title="Маршрут">
        {route.loading ? (
          <Loading />
        ) : route.error || !route.data ? (
          <Empty>Такой маршрут не найден.</Empty>
        ) : (
          <>
            <p className="small">
              {route.data.ids.length > 1 ? `Прыжков: ${jumps}` : 'Откуда и куда — одна система.'}
            </p>
            <button className="ghost small" onClick={check} disabled={checking || route.data.ids.length < 2}>
              {checking ? `Проверено систем: ${danger?.length ?? 0} из ${route.data.ids.length}` : 'Проверить опасность по zKillboard'}
            </button>
            {danger && !checking && !hot.length && <p className="good small">За последний час на маршруте убийств нет.</p>}
            {hot.length > 0 && (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Система</th>
                    <th className="num">Убийств</th>
                    <th>Что там</th>
                  </tr>
                </thead>
                <tbody>
                  {hot.map((d) => (
                    <DangerRow key={d.systemId} d={d} />
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">
              Объём считается упакованным, как его везут. Предел ISK за рейс снижает то, что можно потерять разом: ганкеры смотрят на стоимость груза. Трюм корабля — без навыков и расширителей,
              поправьте его сами. Цены курьера — ваши вводные, а не рынок: сверьте с настоящими предложениями.
            </p>
          </>
        )}
      </Card>
    </>
  )
}

function DangerRow({ d }: { d: SystemDanger }) {
  const info = useAsync(() => window.api.sde.system(d.systemId), [d.systemId])
  const notes = [d.camps.length ? `кемп на вратах: ${d.camps.length}` : '', d.bubbles ? 'бублы' : '', d.smartbombs ? 'смартбомбы' : ''].filter(Boolean).join(', ')
  return (
    <tr>
      <td>
        {info.data && <Sec value={info.data.sec} />} {info.data?.n ?? d.systemId}
      </td>
      <td className="num">{fmtNum(d.kills.length)}</td>
      <td className={notes ? 'warn-text small' : 'muted small'}>{notes || '—'}</td>
    </tr>
  )
}
