// Market tools: hub arbitrage and the LP store calculator.

import { useEffect, useMemo, useState } from 'react'
import type { MarketNode } from '../../../shared/sde'
import { useApp, useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, Stat } from '../components/ui'
import { esi, resolveIds, resolveNames } from '../lib/esi'
import { fmtIsk, fmtNum } from '../lib/format'
import { HUBS, hubPrices, jitaPrices, type Price } from '../lib/market'
import { getBasic, primeBasics, requestBasics, tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { locale } from '../i18n'

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
}

export function Arbitrage() {
  const [path, setPath] = useState<number[]>([])
  const [mode, setMode] = useState<'instant' | 'order'>('instant')
  const [from, setFrom] = useState<number | 0>(0)
  const [to, setTo] = useState<number | 0>(0)
  const [tax, setTax] = useState(3.37)
  const [broker, setBroker] = useState(1.5)
  const [minMargin, setMinMargin] = useState(5)
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

  const deals = useMemo<Deal[]>(() => {
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
          const deal: Deal = { typeId: id, from: a.name, to: b.name, buy, sell, profit, margin, units, total: profit * units, perM3: vol > 0 ? profit / vol : Infinity }
          if (!best || deal.total > best.total) best = deal
        }
      }
      if (best) out.push(best)
    }
    return out.sort((x, y) => y.total - x.total).slice(0, 300)
  }, [scan.data, mode, from, to, tax, broker, minMargin])

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
                    <td className="num">{fmtIsk(d.sell, true)}</td>
                    <td className="num good">{fmtIsk(d.profit, true)}</td>
                    <td className="num">{pct(d.margin)}</td>
                    <td className="num">{fmtNum(d.units)}</td>
                    <td className="num">
                      <b>{fmtIsk(d.total, true)}</b>
                    </td>
                    <td className="num muted">{Number.isFinite(d.perM3) ? fmtIsk(d.perM3, true) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Цена — лучший ордер в хабе; при большой партии следующие ордера дороже, поэтому «прибыль всего» — верхняя оценка. Проверьте
            стакан перед покупкой и учтите перевозку (ISK / м³ — прибыль на кубометр груза).
          </p>
        </Card>
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
  const [showBpc, setShowBpc] = useState(false)
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

  const rows = useMemo(() => {
    if (!store.data) return []
    const { offers, prices, basics } = store.data
    return offers
      .map((o) => {
        const isBpc = basics[o.type_id]?.c === BLUEPRINT_CATEGORY
        const p = prices.get(o.type_id)
        const unit = basis === 'sell' ? (p?.sell.best ?? 0) : (p?.buy.best ?? 0)
        const required = o.required_items.reduce((s, r) => s + (prices.get(r.type_id)?.sell.best ?? 0) * r.quantity, 0)
        const gross = unit * o.quantity * (1 - tax / 100)
        const value = gross - o.isk_cost - required
        return { o, isBpc, unit, required, value, perLp: o.lp_cost ? value / o.lp_cost : 0, volume: p?.sell.volume ?? 0, priced: unit > 0 }
      })
      .filter((r) => (showBpc || !r.isBpc) && r.o.lp_cost > 0)
      .sort((a, b) => b.perLp - a.perLp)
  }, [store.data, basis, tax, showBpc])

  const myLp = mine.data?.find((m) => m.id === corp?.id)?.lp ?? 0
  const best = rows.find((r) => r.priced && r.value > 0)

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
              <input value={manual} placeholder="Например, Caldari Navy" onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void pickManual()} />
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
          <label className="check">
            <input type="checkbox" checked={showBpc} onChange={(e) => setShowBpc(e.target.checked)} />
            Показывать чертежи
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
                  <th className="num">На продаже в Jita</th>
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
                    </td>
                    <td className="num">{r.priced ? fmtIsk(r.unit * r.o.quantity, true) : <span className="muted">нет цены</span>}</td>
                    <td className={`num ${r.value > 0 ? 'good' : 'bad'}`}>{r.priced ? fmtIsk(r.value, true) : '—'}</td>
                    <td className="num">
                      <b>{r.priced ? fmtNum(Math.round(r.perLp)) : '—'}</b>
                    </td>
                    <td className="num muted">{fmtNum(r.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Итог = выручка за вычетом налога − ISK магазина − стоимость сдаваемых предметов по цене продажи Jita. Смотрите на «На продаже в Jita»: редкий товар продаётся
              медленно. Чертежи (копии) не имеют рыночной цены и по умолчанию скрыты.
            </p>
          </Card>
        </>
      )}
    </>
  )
}
