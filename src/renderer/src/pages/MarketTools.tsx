// Market tools: hub arbitrage and the LP store calculator.

import { useEffect, useMemo, useState } from 'react'
import { lpOfferValue, tradedPrice } from '../../../shared/lpStore'
import { fillCost, loadHold, walkBooks, type Level } from '../../../shared/orderBook.ts'
import { useFeeDefaults, useTradeFees } from '../lib/tradeFees'
import type { MarketNode } from '../../../shared/sde'
import { useApp, useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, Stat } from '../components/ui'
import { esi, resolveIds, resolveNames } from '../lib/esi'
import { fmtIsk, fmtNum } from '../lib/format'
import { HUBS, hubPrices, jitaPrices, marketHistory, stationAsks, type Price } from '../lib/market'
import { getBasic, primeBasics, requestBasics, tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { locale, translate } from '../i18n'

const pct = (v: number) => `${(v * 100).toLocaleString(locale(), { maximumFractionDigits: 1 })}%`

/** Cascading market group selects: category → group → subgroup. */
function GroupPicker({ value, onChange }: { value: number[]; onChange: (path: number[]) => void }) {
  const lang = useLang()
  const [levels, setLevels] = useState<MarketNode[][]>([])
  useEffect(() => {
    let live = true
    void (async () => {
      const out: MarketNode[][] = [(await window.api.sde.marketChildren(null, 'name', lang)).groups]
      for (const id of value) {
        const next = (await window.api.sde.marketChildren(id, 'name', lang)).groups
        if (!next.length) break
        out.push(next)
      }
      if (live) setLevels(out)
    })()
    return () => {
      live = false
    }
  }, [value.join(','), lang])
  return (
    <div className="row group-picker">
      {levels.map((opts, i) => (
        <select key={i} value={value[i] ?? ''} onChange={(e) => onChange([...value.slice(0, i), ...(e.target.value ? [Number(e.target.value)] : [])])}>
          <option value="">{i === 0 ? '— категория рынка —' : '— все —'}</option>
          {opts.map((g) => (
            <option key={g.id} value={g.id}>
              {`${tn(g.n, lang)} (${g.count})`}
            </option>
          ))}
        </select>
      ))}
    </div>
  )
}

// ---------------- Arbitrage ----------------

interface Deal {
  typeId: number
  from: string
  to: string
  buy: number
  sell: number
  profit: number
  margin: number
  units: number
  total: number
  perM3: number
  /** Walked through the real order books (and, by order, the destination's trades) */
  checked?: boolean
  /** Units sold a day there (when checked) */
  perDay?: number
  /** m³ a unit */
  vol: number
  /** One trip with the cargo hold set: units that fit and their profit */
  trip?: { units: number; profit: number }
}

/** The best deals walked through the real order books (two ESI calls each). */
const ARBITRAGE_CHECKED = 40
/** LP offers whose hand-in items are costed up the real order book */
const LP_HANDIN_CHECKED = 30

export function Arbitrage() {
  const [path, setPath] = useState<number[]>([])
  const [mode, setMode] = useState<'instant' | 'order'>('instant')
  const [from, setFrom] = useState<number | 0>(0)
  const [to, setTo] = useState<number | 0>(0)
  const [tax, setTax] = useState(3.37)
  const [broker, setBroker] = useState(1.5)
  // The pilot's own fees at the hub they sell in (skills and standings).
  const fees = useTradeFees(HUBS.find((h) => h.stationId === to)?.stationId)
  useFeeDefaults(fees, setTax, setBroker)
  const [minMargin, setMinMargin] = useState(5)
  /** The pilot's cargo hold, m³ (0: not set): units that fit and the profit of one trip */
  const [cargo, setCargo] = useState(() => {
    try {
      return Number(localStorage.getItem('canopus.arbitrageCargo')) || 0
    } catch {
      return 0
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('canopus.arbitrageCargo', String(cargo))
    } catch {
      // A convenience only.
    }
  }, [cargo])
  const [run, setRun] = useState(0)
  const scope = path.at(-1)

  const scan = useAsync(async () => {
    if (!run || !scope) return null
    const ids = (await window.api.sde.marketTypesIn(scope)).slice(0, 3000)
    requestBasics(ids)
    const basics = await window.api.sde.basics(ids)
    primeBasics(basics)
    const hubs = HUBS.filter((h) => !from || !to || h.stationId === from || h.stationId === to)
    const prices = new Map<number, Map<number, Price>>()
    for (const h of hubs) prices.set(h.stationId, await hubPrices(h.stationId, ids))
    return { ids, basics, prices, hubs }
  }, [run])

  const raw = useMemo<Deal[]>(() => {
    if (!scan.data) return []
    const { ids, basics, prices, hubs } = scan.data
    const out: Deal[] = []
    for (const id of ids) {
      let best: Deal | null = null
      for (const a of hubs) {
        if (from && a.stationId !== from) continue
        const pa = prices.get(a.stationId)?.get(id)
        const buy = pa?.sell.best ?? 0
        if (!buy || !pa?.sell.volume) continue
        for (const b of hubs) {
          if (b === a || (to && b.stationId !== to)) continue
          const pb = prices.get(b.stationId)?.get(id)
          if (!pb) continue
          const sell = mode === 'instant' ? pb.buy.best : pb.sell.best > 0 ? pb.sell.best - 0.01 : 0
          if (!sell) continue
          const revenue = sell * (1 - tax / 100 - (mode === 'order' ? broker / 100 : 0))
          // Buying from sell orders costs no fees; selling pays the sales tax (and the broker fee for an order).
          const profit = revenue - buy
          const margin = profit / buy
          if (margin * 100 < minMargin) continue
          const units = Math.floor(mode === 'instant' ? Math.min(pa.sell.volume, pb.buy.volume) : pa.sell.volume)
          if (units <= 0) continue
          const vol = basics[id]?.v ?? 0
          // An upper estimate (the whole book at the best price), only to pick which deals to walk through the real books.
          const deal: Deal = { typeId: id, from: a.name, to: b.name, buy, sell, profit, margin, units, total: profit * units, perM3: vol > 0 ? profit / vol : Infinity, vol }
          if (!best || deal.total > best.total) best = deal
        }
      }
      if (best) out.push(best)
    }
    return out.sort((x, y) => y.total - x.total).slice(0, 300)
  }, [scan.data, mode, from, to, tax, broker, minMargin])

  // The best deals walked through the real order books (ESI): the source hub's sell orders against the
  // destination's buy orders, or — selling by order — against what the item really trades at there, a week of it
  // (a slow item's cheapest listing never sells). The best order alone overstates a deal, book averages hide it.
  const [checks, setChecks] = useState<Map<string, { asks: Level[]; bids: Level[]; perDay?: number } | null>>(new Map())
  useEffect(() => {
    if (!raw.length) return
    let live = true
    const today = new Date().toISOString().slice(0, 10)
    const key = (d: Deal) => `${mode}|${d.typeId}|${d.from}|${d.to}`
    const todo = raw.slice(0, ARBITRAGE_CHECKED).filter((d) => !checks.has(key(d)))
    void (async () => {
      const found = new Map(checks)
      let next = 0
      const worker = async () => {
        while (live && next < todo.length) {
          const d = todo[next++]
          const src = HUBS.find((h) => h.name === d.from)!
          const dst = HUBS.find((h) => h.name === d.to)!
          try {
            const book = (hub: typeof src, side: 'sell' | 'buy') =>
              esi<{ price: number; volume_remain: number; location_id: number; min_volume?: number }[]>(`/markets/${hub.regionId}/orders/?type_id=${d.typeId}&order_type=${side}`, {
                allPages: true
              }).then((o) => o.filter((x) => x.location_id === hub.stationId).map((x) => ({ price: x.price, volume: x.volume_remain, min: x.min_volume })))
            const asks = await book(src, 'sell')
            if (mode === 'instant') {
              found.set(key(d), { asks, bids: await book(dst, 'buy') })
            } else {
              const h = await marketHistory(dst.regionId, d.typeId)
              if (!h) throw new Error('no history')
              const t = tradedPrice(h, today)
              const price = Math.min(d.sell, t.price)
              found.set(key(d), { asks, bids: price > 0 ? [{ price, volume: Math.round(t.perDay * 7) }] : [], perDay: t.perDay })
            }
          } catch {
            found.set(key(d), null)
          }
        }
      }
      await Promise.all(Array.from({ length: 6 }, worker))
      if (live) setChecks(found)
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, mode])

  const deals = useMemo<Deal[]>(() => {
    const keep = 1 - tax / 100 - (mode === 'order' ? broker / 100 : 0)
    // How many fit in the hold (a unit's packaged volume); unknown volume: the hold doesn't limit it.
    const fits = (d: Deal) => (cargo > 0 && d.vol > 0 ? Math.floor(cargo / d.vol + 1e-9) : Infinity)
    return raw
      .flatMap((d): Deal[] => {
        const c = checks.get(`${mode}|${d.typeId}|${d.from}|${d.to}`)
        if (!c) {
          const units = Math.min(d.units, fits(d))
          return [{ ...d, checked: false, ...(cargo > 0 ? { trip: { units, profit: units * d.profit } } : {}) }]
        }
        const w = walkBooks(c.asks, c.bids, keep)
        if (!w.units) return []
        const profit = w.profit / w.units
        const margin = profit / w.avgBuy
        if (margin * 100 < minMargin) return []
        // One trip: the best of the book up to what fits (the first units of a book pay more than its average).
        const t = cargo > 0 ? walkBooks(c.asks, c.bids, keep, fits(d)) : null
        return [{ ...d, buy: w.avgBuy, sell: w.avgSell, profit, margin, units: w.units, total: w.profit, checked: true, perDay: c.perDay, ...(t ? { trip: { units: t.units, profit: t.profit } } : {}) }]
      })
      .sort((x, y) => Number(y.checked !== false) - Number(x.checked !== false) || (cargo > 0 ? (y.trip?.profit ?? 0) - (x.trip?.profit ?? 0) : y.total - x.total))
  }, [raw, checks, mode, minMargin, tax, broker, cargo])

  // The best load for one trip on one route: the hold filled with the most ISK per m³ (checked deals only).
  const bestLoad = useMemo(() => {
    if (!(cargo > 0)) return null
    const routes = new Map<string, Deal[]>()
    for (const d of deals.filter((x) => x.checked)) routes.set(`${d.from} → ${d.to}`, [...(routes.get(`${d.from} → ${d.to}`) ?? []), d])
    let best: { route: string; load: ReturnType<typeof loadHold> } | null = null
    for (const [route, list] of routes) {
      const load = loadHold(list.map((d) => ({ id: d.typeId, perUnit: d.profit, volume: d.vol, units: d.units })), cargo)
      if (!best || load.profit > best.load.profit) best = { route, load }
    }
    return best && best.load.profit > 0 ? best : null
  }, [deals, cargo])

  return (
    <>
      <Card title="Арбитраж между торговыми хабами">
        <p className="muted small">
          Покупаем по лучшей цене продажи в одном хабе и продаём в другом: сразу в ордера на покупку или выставляя свой ордер на продажу. Выберите категорию рынка —
          Canopus сравнит цены во всех пяти хабах (данные Fuzzwork, обновляются каждые ~30 минут).
        </p>
        <GroupPicker value={path} onChange={setPath} />
        <div className="row arbitrage-form">
          <label>
            Откуда
            <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              <option value={0}>Любой хаб</option>
              {HUBS.map((h) => (
                <option key={h.stationId} value={h.stationId}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Куда
            <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
              <option value={0}>Любой хаб</option>
              {HUBS.map((h) => (
                <option key={h.stationId} value={h.stationId}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Как продавать
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="instant">Сразу в ордера на покупку</option>
              <option value="order">Выставить ордер на продажу</option>
            </select>
          </label>
          <label>
            Налог с продаж, %
            <input type="number" step={0.01} value={tax} onChange={(e) => setTax(Number(e.target.value))} />
          </label>
          {mode === 'order' && (
            <label>
              Брокерская комиссия, %
              <input type="number" step={0.01} value={broker} onChange={(e) => setBroker(Number(e.target.value))} />
            </label>
          )}
          <label>
            Мин. маржа, %
            <input type="number" step={1} value={minMargin} onChange={(e) => setMinMargin(Number(e.target.value))} />
          </label>
          <label title="Объём трюма вашего корабля: Canopus посчитает, сколько штук влезет и прибыль за одну ходку">
            Объём карго, м³
            <input type="number" min={0} step={100} value={cargo || ''} placeholder="не задан" onChange={(e) => setCargo(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <button disabled={!scope || scan.loading} onClick={() => setRun((r) => r + 1)}>
            {scan.loading ? 'Собираю цены…' : 'Найти сделки'}
          </button>
        </div>
      </Card>
      {scan.loading ? (
        <Loading label="Собираю цены по хабам…" />
      ) : scan.error ? (
        <ErrorBox error={scan.error} />
      ) : scan.data ? (
        <>
        {bestLoad && (
          <Card title="Лучшая загрузка на одну ходку">
            <div className="stats-row">
              <Stat label="Маршрут" value={bestLoad.route} />
              <Stat label="Прибыль за ходку" value={<span className="good">{fmtIsk(bestLoad.load.profit, true)}</span>} sub={`${fmtNum(Math.round(bestLoad.load.used))} / ${fmtNum(cargo)} м³`} />
            </div>
            <table className="table compact">
              <tbody>
                {bestLoad.load.picks.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <TypeLink id={p.id} size={20} />
                    </td>
                    <td className="num">{`${fmtNum(p.units)} ${translate('шт')}`}</td>
                    <td className="num good">{fmtIsk(p.profit, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Трюм заполняется самыми выгодными на кубометр проверенными сделками одного маршрута; прибыль — по средней цене сделки в стакане. Перевозку и риск
              маршрута Canopus не учитывает.
            </p>
          </Card>
        )}
        <Card title={`Сделки: ${deals.length}`}>
          {!deals.length ? (
            <Empty>Выгодных сделок с такой маржой нет — уменьшите мин. маржу или выберите другую категорию.</Empty>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Предмет</th>
                  <th>Маршрут</th>
                  <th className="num">Покупка</th>
                  <th className="num">Продажа</th>
                  <th className="num">Прибыль / шт</th>
                  <th className="num">Маржа</th>
                  <th className="num">Доступно, шт</th>
                  <th className="num">Прибыль всего</th>
                  {cargo > 0 && (
                    <th className="num" title="Сколько штук влезает в трюм и прибыль за одну ходку">
                      За ходку
                    </th>
                  )}
                  <th className="num">ISK / м³</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.typeId}>
                    <td>
                      <TypeLink id={d.typeId} size={20} />
                    </td>
                    <td className="nowrap">{`${d.from} → ${d.to}`}</td>
                    <td className="num">{fmtIsk(d.buy, true)}</td>
                    <td className="num">
                      {fmtIsk(d.sell, true)}
                      {d.checked === false && <div className="muted small">{translate('не проверено')}</div>}
                      {d.perDay !== undefined && <div className={`small ${d.perDay < 1 ? 'warn' : 'muted'}`}>{`${fmtNum(Math.round(d.perDay * 10) / 10)} ${translate('в день')}`}</div>}
                    </td>
                    <td className="num good">{fmtIsk(d.profit, true)}</td>
                    <td className="num">{pct(d.margin)}</td>
                    <td className="num">{fmtNum(d.units)}</td>
                    <td className="num">
                      <b>{d.checked === false ? '…' : fmtIsk(d.total, true)}</b>
                    </td>
                    {cargo > 0 && (
                      <td className="num">
                        {d.trip ? (
                          <>
                            <b>{fmtIsk(d.trip.profit, true)}</b>
                            <div className="muted small">{`${fmtNum(d.trip.units)} ${translate('шт')}${d.vol > 0 ? ` · ${fmtNum(Math.round(d.trip.units * d.vol))} м³` : ''}`}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                    <td className="num muted">{Number.isFinite(d.perM3) ? fmtIsk(d.perM3, true) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Лучшие сделки пройдены по настоящим стаканам ESI: покупаем ордера на продажу в станции хаба, пока каждая штука ещё приносит прибыль после налога, —
            «Доступно» и «Прибыль всего» показывают именно это, цены — средние по сделке. Сразу в ордера на покупку — только заявки в станции хаба назначения;
            ордером — не дороже цены, по которой товар там реально продавался, и не больше недели его продаж. Остальные строки — по лучшему ордеру, не проверены
            («…»). Учтите перевозку (ISK / м³ — прибыль на кубометр груза). Продавая ордером, каждое изменение цены снова берёт брокерскую (меньше с Advanced
            Broker Relations) — в расчёте одно выставление.
          </p>
        </Card>
        </>
      ) : (
        <Empty>Выберите категорию рынка и нажмите «Найти сделки».</Empty>
      )}
    </>
  )
}

// ---------------- LP store ----------------

interface LpOffer {
  offer_id: number
  type_id: number
  quantity: number
  lp_cost: number
  isk_cost: number
  required_items: { type_id: number; quantity: number }[]
}

/** Corporations with popular LP stores (faction warfare, navies, pirate, Sisters). */
const POPULAR_CORPS = [
  'Caldari Navy',
  'Federation Navy',
  'Amarr Navy',
  'Republic Fleet',
  'State Protectorate',
  'Federal Defense Union',
  '24th Imperial Crusade',
  'Tribal Liberation Force',
  'Sisters of EVE',
  'Guristas',
  'Serpentis Corporation',
  'Blood Raiders',
  "Sansha's Nation",
  'Angel Cartel',
  "Mordu's Legion Command",
  'Thukker Mix',
  'Ministry of War',
  'Center for Advanced Studies'
]

const BLUEPRINT_CATEGORY = 9

export function LpStore() {
  const lang = useLang()
  const { active } = useApp()
  const [corp, setCorp] = useState<{ id: number; name: string } | null>(null)
  const [basis, setBasis] = useState<'sell' | 'buy'>('sell')
  const [tax, setTax] = useState(3.37)
  const [broker, setBroker] = useState(1.5)
  // The pilot's own fees in Jita (skills and standings).
  const fees = useTradeFees()
  useFeeDefaults(fees, setTax, setBroker)
  const [showBpc, setShowBpc] = useState(false)
  /** Hide what sells less than once a day: its rate can't be had for a real amount of LP */
  const [liquidOnly, setLiquidOnly] = useState(true)
  /** What each product really trades at in The Forge, and how many a day (filled in as the history loads) */
  const [traded, setTraded] = useState<Map<number, { price: number; perDay: number; days: number }>>(new Map())
  const [tradedLoading, setTradedLoading] = useState(0)
  const [manual, setManual] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)

  // The character's LP balances (esi-characters.read_loyalty.v1).
  const mine = useAsync(async () => {
    if (!active) return []
    const lp = await esi<{ corporation_id: number; loyalty_points: number }[]>(`/characters/${active.id}/loyalty/points/`, { characterId: active.id })
    const names = await resolveNames(lp.map((x) => x.corporation_id))
    return lp.map((x) => ({ id: x.corporation_id, name: names.get(x.corporation_id) ?? String(x.corporation_id), lp: x.loyalty_points })).sort((a, b) => b.lp - a.lp)
  }, [active?.id])
  const popular = useAsync(async () => ((await resolveIds(POPULAR_CORPS)).corporations ?? []).sort((a, b) => a.name.localeCompare(b.name)), [])

  const store = useAsync(async () => {
    if (!corp) return null
    const offers = await esi<LpOffer[]>(`/loyalty/stores/${corp.id}/offers/`)
    const ids = [...new Set(offers.flatMap((o) => [o.type_id, ...o.required_items.map((r) => r.type_id)]))]
    const [prices, basics] = await Promise.all([jitaPrices(ids), window.api.sde.basics(ids)])
    primeBasics(basics)
    return { offers, prices, basics }
  }, [corp?.id])

  // The trade history of every product, a few at a time: a slow item's cheapest sell order is not its price.
  useEffect(() => {
    if (!store.data) return
    let live = true
    const ids = [...new Set(store.data.offers.map((o) => o.type_id))].filter((id) => store.data!.basics[id]?.c !== BLUEPRINT_CATEGORY)
    const today = new Date().toISOString().slice(0, 10)
    const found = new Map<number, { price: number; perDay: number; days: number }>()
    setTraded(new Map())
    setTradedLoading(ids.length)
    let next = 0
    const worker = async () => {
      while (live && next < ids.length) {
        const id = ids[next++]
        const history = await marketHistory(HUBS[0].regionId, id)
        // An empty history is an answer (it hasn't traded), a failed load isn't.
        if (history) found.set(id, tradedPrice(history, today))
        if (!live) return
        setTradedLoading((n) => n - 1)
        if (found.size % 15 === 0 || next >= ids.length) setTraded(new Map(found))
      }
    }
    void Promise.all(Array.from({ length: 8 }, worker)).then(() => live && setTraded(new Map(found)))
    return () => {
      live = false
    }
  }, [store.data])

  const base = useMemo(() => {
    if (!store.data) return []
    const { offers, prices, basics } = store.data
    return offers
      .map((o) => {
        const isBpc = basics[o.type_id]?.c === BLUEPRINT_CATEGORY
        const p = prices.get(o.type_id)
        const v = lpOfferValue(o, (id) => { const x = prices.get(id); return x && { sell: x.sell.best, buy: x.buy.best, ...(id === o.type_id && traded.has(id) ? { traded: traded.get(id)!.price } : {}) } }, basis, tax, broker)
        return { o, isBpc, ...v, volume: p?.sell.volume ?? 0, perDay: traded.get(o.type_id)?.perDay ?? 0 }
      })
      .filter((r) => (showBpc || !r.isBpc) && r.o.lp_cost > 0 && !(liquidOnly && !r.isBpc && traded.has(r.o.type_id) && r.perDay < 1))
      // Offers without a full price at the bottom: their figure is unknown, not a bargain.
      // Unchecked sale prices (history still loading or not loaded) under the checked ones.
      .sort((a, b) => Number(b.priced) - Number(a.priced) || Number(b.checked) - Number(a.checked) || b.perLp - a.perLp)
  }, [store.data, basis, tax, broker, showBpc, traded, liquidOnly])

  // Hand-ins come by the hundred (106 insignia): the best offers' items costed up Jita's sell orders.
  const topIds = base.filter((r) => r.priced && r.checked && r.o.required_items.length).slice(0, LP_HANDIN_CHECKED).map((r) => r.o.offer_id)
  const handIns = useAsync(async () => {
    const out = new Map<number, { cost: number; short: boolean }>()
    for (const r of base.filter((x) => topIds.includes(x.o.offer_id))) {
      let cost = 0
      let short = false
      for (const it of r.o.required_items) {
        const c = fillCost(await stationAsks(HUBS[0], it.type_id), it.quantity)
        const best = store.data?.prices.get(it.type_id)?.sell.best ?? 0
        cost += c.short ? best * it.quantity : Math.max(c.total, best * it.quantity)
        short ||= c.short > 0
      }
      out.set(r.o.offer_id, { cost, short })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topIds.join(',')])

  const rows = useMemo(() => {
    return base
      .map((r) => {
        const h = handIns.data?.get(r.o.offer_id)
        if (!h) return { ...r, short: false }
        const value = r.value + r.required - h.cost
        return { ...r, required: h.cost, value, perLp: r.o.lp_cost ? value / r.o.lp_cost : 0, short: h.short }
      })
      .sort((a, b) => Number(b.priced) - Number(a.priced) || Number(b.checked) - Number(a.checked) || b.perLp - a.perLp)
  }, [base, handIns.data])

  const myLp = mine.data?.find((m) => m.id === corp?.id)?.lp ?? 0
  /** Days the market takes to absorb everything the pilot's LP buy of this offer */
  const sellDays = (r: { o: LpOffer; perDay: number }) => (r.perDay > 0 ? (Math.floor(myLp / r.o.lp_cost) * r.o.quantity) / r.perDay : Infinity)
  // Only an offer whose sale price was checked against the trade history: an unchecked one can be a lone listing.
  const best = rows.find((r) => r.priced && r.value > 0 && r.checked)

  async function pickManual() {
    setManualError(null)
    const found = (await resolveIds([manual.trim()])).corporations?.[0]
    if (found) setCorp(found)
    else setManualError('Корпорация с таким точным названием не найдена')
  }

  return (
    <>
      <Card title="LP-магазин: что выгоднее всего купить за очки лояльности">
        <div className="row lp-form">
          <label>
            Корпорация
            <select
              value={corp?.id ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value)
                const all = [...(mine.data ?? []), ...(popular.data ?? [])]
                const c = all.find((x) => x.id === id)
                setCorp(c ? { id: c.id, name: c.name } : null)
              }}
            >
              <option value="">— выберите —</option>
              {!!mine.data?.length && (
                <optgroup label="Ваши очки лояльности">
                  {mine.data.map((m) => (
                    <option key={m.id} value={m.id}>
                      {`${m.name} — ${fmtNum(m.lp)} LP`}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Популярные магазины">
                {(popular.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            Или точное название
            <div className="row">
              <input className="wh-search" value={manual} placeholder="Например, Caldari Navy" onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void pickManual()} />
              <button className="ghost" disabled={!manual.trim()} onClick={() => void pickManual()}>
                Открыть
              </button>
            </div>
          </label>
          <label>
            Продавать
            <select value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
              <option value="sell">Ордером на продажу (цена продажи Jita)</option>
              <option value="buy">Сразу в ордера на покупку</option>
            </select>
          </label>
          <label>
            Налог с продаж, %
            <input type="number" step={0.01} value={tax} onChange={(e) => setTax(Number(e.target.value))} />
          </label>
          <label>
            Брокерская, %
            <input type="number" step={0.01} value={broker} onChange={(e) => setBroker(Number(e.target.value))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={showBpc} onChange={(e) => setShowBpc(e.target.checked)} />
            Показывать чертежи
          </label>
          <label className="check" title="Товар, который продаётся реже раза в день, не продать по этому курсу в заметном количестве">
            <input type="checkbox" checked={liquidOnly} onChange={(e) => setLiquidOnly(e.target.checked)} />
            Скрыть редко продающиеся (меньше 1 в день)
          </label>
        </div>
        {manualError && <div className="warn">{manualError}</div>}
      </Card>

      {!corp ? (
        <Empty>Выберите корпорацию — из ваших очков лояльности или из популярных магазинов.</Empty>
      ) : store.loading ? (
        <Loading label="Загружаю магазин и цены Jita…" />
      ) : store.error ? (
        <ErrorBox error={store.error} />
      ) : (
        <>
          {tradedLoading > 0 && <div className="muted small">{`${translate('Проверяю историю торгов:')} ${tradedLoading}`}</div>}
          <div className="stats-row">
            <Stat label="Предложений" value={rows.length} />
            <Stat label="Лучший курс" value={best ? `${fmtNum(Math.round(best.perLp))} ISK/LP` : '—'} sub={best ? tn(getBasic(best.o.type_id)?.n, lang) : undefined} />
            {myLp > 0 && best && <Stat label="Ваши LP" value={fmtNum(myLp)} sub={`≈ ${fmtIsk(myLp * best.perLp, true)} по лучшему курсу`} />}
          </div>
          <Card>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Предмет</th>
                  <th className="num">LP</th>
                  <th className="num">ISK</th>
                  <th>Нужно сдать</th>
                  <th className="num">Выручка</th>
                  <th className="num">Итог</th>
                  <th className="num">ISK / LP</th>
                  <th className="num" title="Сколько штук в среднем продаётся в The Forge за день (30 дней)">
                    Продаётся в день
                  </th>
                  {myLp > 0 && (
                    <th className="num" title="За сколько дней рынок поглотит всё, что вы купите на свои LP">
                      Ваши LP продадутся за
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.o.offer_id} className={r.isBpc ? 'muted' : ''}>
                    <td>
                      {r.o.quantity > 1 && <span className="muted">{`${fmtNum(r.o.quantity)}× `}</span>}
                      <TypeLink id={r.o.type_id} size={20} />
                    </td>
                    <td className="num">{fmtNum(r.o.lp_cost)}</td>
                    <td className="num">{r.o.isk_cost ? fmtIsk(r.o.isk_cost, true) : '—'}</td>
                    <td className="small">
                      {r.o.required_items.map((it) => (
                        <div key={it.type_id}>
                          {`${fmtNum(it.quantity)}× `}
                          <TypeLink id={it.type_id} size={16} />
                        </div>
                      ))}
                      {r.required > 0 && <div className="muted">{fmtIsk(r.required, true)}</div>}
                      {r.short && <div className="warn small">{translate('в Jita не хватает на одну сдачу')}</div>}
                      {r.unit > 0 && !r.priced && <div className="warn small">у части предметов нет цены в Jita</div>}
                    </td>
                    <td className="num">
                      {r.unit > 0 ? (
                        fmtIsk(r.unit * r.o.quantity, true)
                      ) : r.checked && basis === 'sell' && traded.get(r.o.type_id)?.price === 0 ? (
                        <span className="bad small">не продавался 90 дней</span>
                      ) : (
                        <span className="muted">нет цены</span>
                      )}
                      {r.unit > 0 && !r.checked && <div className="muted small">{translate('по ордеру, история не проверена')}</div>}
                    </td>
                    <td className={`num ${r.value > 0 ? 'good' : 'bad'}`}>{r.priced ? fmtIsk(r.value, true) : '—'}</td>
                    <td className="num">
                      <b>{r.priced ? fmtNum(Math.round(r.perLp)) : '—'}</b>
                    </td>
                    <td className={`num ${traded.has(r.o.type_id) && r.perDay < 1 ? 'bad' : 'muted'}`}>{r.isBpc ? '—' : r.perDay ? fmtNum(Math.round(r.perDay * 10) / 10) : r.checked ? '0' : '…'}</td>
                    {myLp > 0 && <td className={`num ${sellDays(r) > 14 ? 'bad' : 'muted'}`}>{r.perDay > 0 ? `${fmtNum(Math.ceil(sellDays(r)))} дн.` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Итог = выручка за вычетом налога − ISK магазина − стоимость сдаваемых предметов по цене продажи Jita. Выручка ордером на продажу — не дороже цены, по
              которой товар реально продавался в The Forge за 30 дней (одинокий дорогой ордер редкого товара не продаётся). Смотрите на «Продаётся в день»: рынок
              небольшой, большую партию придётся продавать неделями или дешевле. Каждое изменение цены ордера снова берёт брокерскую — в расчёте одно выставление.
              Чертежи (копии) не имеют рыночной цены и по умолчанию скрыты.
            </p>
          </Card>
        </>
      )}
    </>
  )
}
