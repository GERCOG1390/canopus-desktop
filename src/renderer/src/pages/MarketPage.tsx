import { useEffect, useState } from 'react'
import { useApp, useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, RequireLogin, SearchBox, Sparkline, Stat, Tabs } from '../components/ui'
import { esi, imageUrl, resolveIds, resolveLocations } from '../lib/esi'
import { LocationName } from '../components/LocationName'
import { MarketTree } from '../components/MarketTree'
import { fmtDate, fmtIsk, fmtNum } from '../lib/format'
import { HUBS, hubPrices, jitaPrices, parseItemList, type Price } from '../lib/market'
import { getBasic, searchTypesSde } from '../lib/sde'
import { useAsync } from '../lib/useAsync'

type Tab = 'prices' | 'appraisal' | 'orders'

export default function MarketPage() {
  const { pageArg } = useApp()
  const [tab, setTab] = useState<Tab>('prices')
  useEffect(() => {
    if (pageArg) setTab('prices')
  }, [pageArg])
  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'prices', label: 'Цены' },
          { id: 'appraisal', label: 'Оценка лута' },
          { id: 'orders', label: 'Мои ордера' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'prices' && <Prices />}
      {tab === 'appraisal' && <Appraisal />}
      {tab === 'orders' && <MyOrders />}
    </div>
  )
}

// ---------------- Prices ----------------

function Prices() {
  const { pageArg } = useApp()
  const lang = useLang()
  const [type, setType] = useState<{ id: number; name: string } | null>(null)
  useEffect(() => {
    if (pageArg) setType({ id: pageArg, name: '' })
  }, [pageArg])

  return (
    <div className="market-layout">
      <aside className="market-browser">
        <SearchBox
          placeholder="Название предмета (рус/англ)…"
          search={(q) => searchTypesSde(q, lang, { marketOnly: true })}
          onSelect={setType}
          renderItem={(t) => (
            <>
              <TypeLink id={t.id} />
              {t.alt && <span className="muted small"> {t.alt}</span>}
            </>
          )}
        />
        <MarketTree selected={type?.id} onPick={(id) => setType({ id, name: '' })} className="market-tree-panel" />
      </aside>
      <div className="market-main">
        {type ? <TypeMarket typeId={type.id} /> : <Empty>Выберите предмет в дереве рынка слева или найдите по названию, чтобы сравнить цены в торговых хабах.</Empty>}
      </div>
    </div>
  )
}

interface Order {
  order_id: number
  is_buy_order: boolean
  price: number
  volume_remain: number
  location_id: number
  min_volume: number
}
interface HistoryDay {
  date: string
  average: number
  highest: number
  lowest: number
  volume: number
  order_count: number
}

function TypeMarket({ typeId }: { typeId: number }) {
  const { data, error, loading } = useAsync(async () => {
    const jita = HUBS[0]
    const [hubs, orders, history] = await Promise.all([
      Promise.all(HUBS.map((h) => hubPrices(h.stationId, [typeId]).then((m) => ({ hub: h, price: m.get(typeId) })))),
      esi<Order[]>(`/markets/${jita.regionId}/orders/?type_id=${typeId}&order_type=all`, { allPages: true }).catch(() => [] as Order[]),
      esi<HistoryDay[]>(`/markets/${jita.regionId}/history/?type_id=${typeId}`).catch(() => [] as HistoryDay[])
    ])
    const inJita = orders.filter((o) => o.location_id === jita.stationId)
    return {
      hubs,
      sells: inJita.filter((o) => !o.is_buy_order).sort((a, b) => a.price - b.price).slice(0, 10),
      buys: inJita.filter((o) => o.is_buy_order).sort((a, b) => b.price - a.price).slice(0, 10),
      history: history.slice(-90)
    }
  }, [typeId])

  if (loading) return <Loading />
  if (!data) return <ErrorBox error={error} />
  const { hubs, sells, buys, history } = data
  const basic = getBasic(typeId)

  const sellPrices = hubs.map((h) => h.price?.sell.best).filter((p): p is number => !!p)
  const buyPrices = hubs.map((h) => h.price?.buy.best).filter((p): p is number => !!p)
  const minSell = Math.min(...sellPrices)
  const maxBuy = Math.max(...buyPrices)
  const last30 = history.slice(-30)
  const avgVolume = last30.reduce((s, d) => s + d.volume, 0) / (last30.length || 1)
  const avgPrice = last30.reduce((s, d) => s + d.average, 0) / (last30.length || 1)

  return (
    <>
      <Card>
        <div className="type-head">
          <img src={imageUrl.typeIcon(typeId, 64)} width={64} height={64} alt="" />
          <div>
            <h2>
              <TypeLink id={typeId} icon={false} />
            </h2>
            <div className="muted">
              {basic && basic.n[1] !== basic.n[0] ? `${basic.n[0]} · ` : ''}type_id {typeId} · нажмите на название — полная информация
            </div>
          </div>
        </div>
      </Card>

      <div className="stats-row">
        <Stat label="Jita: продажа" value={fmtIsk(hubs[0].price?.sell.best)} />
        <Stat label="Jita: покупка" value={fmtIsk(hubs[0].price?.buy.best)} />
        <Stat label="Ср. цена (30 дн)" value={fmtIsk(avgPrice)} />
        <Stat label="Ср. объём в день" value={fmtNum(avgVolume)} sub="The Forge, 30 дней" />
      </div>

      <div className="two-col">
        <Card title="Торговые хабы">
          <table className="table">
            <thead>
              <tr>
                <th>Хаб</th>
                <th className="num">Продажа</th>
                <th className="num">Покупка</th>
                <th className="num">Спред</th>
                <th className="num">На продаже</th>
              </tr>
            </thead>
            <tbody>
              {hubs.map(({ hub, price }) => (
                <HubRow key={hub.stationId} name={hub.name} price={price} minSell={minSell} maxBuy={maxBuy} />
              ))}
            </tbody>
          </table>
          <p className="muted small">Зелёным отмечены лучшая цена покупки у продавцов и лучшая цена продажи в buy-ордера.</p>
        </Card>

        <Card title="История цен, The Forge (90 дней)">
          {history.length > 1 ? (
            <>
              <Sparkline values={history.map((d) => d.average)} width={420} height={90} />
              <div className="muted small">
                {fmtDate(history[0].date).slice(0, 10)} — {fmtDate(history.at(-1)!.date).slice(0, 10)} · мин {fmtIsk(Math.min(...history.map((d) => d.lowest)), true)} · макс{' '}
                {fmtIsk(Math.max(...history.map((d) => d.highest)), true)}
              </div>
            </>
          ) : (
            <Empty>Нет истории торгов</Empty>
          )}
        </Card>
      </div>

      <div className="two-col">
        <OrderBook title="Jita 4-4: продают" orders={sells} />
        <OrderBook title="Jita 4-4: покупают" orders={buys} />
      </div>
    </>
  )
}

function HubRow({ name, price, minSell, maxBuy }: { name: string; price?: Price; minSell: number; maxBuy: number }) {
  const sell = price?.sell.best || 0
  const buy = price?.buy.best || 0
  const spread = sell && buy ? ((sell - buy) / sell) * 100 : null
  return (
    <tr>
      <td>{name}</td>
      <td className={`num ${sell && sell === minSell ? 'good' : ''}`}>{sell ? fmtIsk(sell) : '—'}</td>
      <td className={`num ${buy && buy === maxBuy ? 'good' : ''}`}>{buy ? fmtIsk(buy) : '—'}</td>
      <td className="num">{spread == null ? '—' : `${spread.toFixed(1)}%`}</td>
      <td className="num">{fmtNum(price?.sell.volume)}</td>
    </tr>
  )
}

function OrderBook({ title, orders }: { title: string; orders: Order[] }) {
  return (
    <Card title={title}>
      {orders.length ? (
        <table className="table compact">
          <thead>
            <tr>
              <th className="num">Цена</th>
              <th className="num">Кол-во</th>
              <th className="num">Мин.</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.order_id}>
                <td className="num">{fmtIsk(o.price)}</td>
                <td className="num">{fmtNum(o.volume_remain)}</td>
                <td className="num">{o.min_volume > 1 ? fmtNum(o.min_volume) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>Нет ордеров</Empty>
      )}
    </Card>
  )
}

// ---------------- Appraisal ----------------

interface AppraisalRow {
  typeId: number
  name: string
  qty: number
  sell: number
  buy: number
  volume: number
}

function Appraisal() {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<AppraisalRow[] | null>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function appraise() {
    setBusy(true)
    setError(null)
    try {
      const items = parseItemList(text)
      const ids = await resolveIds(items.map((i) => i.name)).catch(() => ({ inventory_types: [] as { id: number; name: string }[] }))
      const byName = new Map((ids.inventory_types ?? []).map((t) => [t.name.toLowerCase(), t]))
      // Names ESI doesn't know (e.g. from a Russian client) are matched exactly against the SDE.
      for (const i of items) {
        const key = i.name.toLowerCase()
        if (byName.has(key)) continue
        const hit = (await window.api.sde.search(i.name, { limit: 5 })).find((t) => t.n.some((n) => n.toLowerCase() === key))
        if (hit) byName.set(key, { id: hit.id, name: hit.n[0] })
      }
      const known = items.filter((i) => byName.has(i.name.toLowerCase()))
      setUnknown(items.filter((i) => !byName.has(i.name.toLowerCase())).map((i) => i.name))
      const prices = await jitaPrices(known.map((i) => byName.get(i.name.toLowerCase())!.id))
      const basics = await window.api.sde.basics(known.map((i) => byName.get(i.name.toLowerCase())!.id)).catch(() => ({}) as Record<number, { v?: number }>)
      setRows(
        known
          .map((i) => {
            const t = byName.get(i.name.toLowerCase())!
            const p = prices.get(t.id)
            return {
              typeId: t.id,
              name: t.name,
              qty: i.qty,
              sell: (p?.sell.best ?? 0) * i.qty,
              buy: (p?.buy.best ?? 0) * i.qty,
              volume: (basics[t.id]?.v ?? 0) * i.qty
            }
          })
          .sort((a, b) => b.sell - a.sell)
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const total = (rows ?? []).reduce((acc, r) => ({ sell: acc.sell + r.sell, buy: acc.buy + r.buy, volume: acc.volume + r.volume }), { sell: 0, buy: 0, volume: 0 })

  return (
    <>
      <Card title="Вставьте список предметов">
        <textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Скопируйте из инвентаря (Ctrl+A, Ctrl+C) или введите построчно:\nTritanium 10000\n5 x Hobgoblin I\nPlagioclase\t2500'}
        />
        <div className="row">
          <button onClick={appraise} disabled={busy || !text.trim()}>
            {busy ? 'Считаю…' : 'Оценить по Jita'}
          </button>
          <button className="ghost" onClick={() => (setText(''), setRows(null), setUnknown([]))}>
            Очистить
          </button>
        </div>
        <ErrorBox error={error} />
        {unknown.length > 0 && <div className="warn">Не распознано: {unknown.join(', ')}</div>}
      </Card>

      {rows && (
        <>
          <div className="stats-row">
            <Stat label="Jita sell" value={fmtIsk(total.sell, true)} sub={fmtIsk(total.sell)} />
            <Stat label="Jita buy" value={fmtIsk(total.buy, true)} sub={fmtIsk(total.buy)} />
            <Stat label="Объём" value={`${fmtNum(total.volume)} м³`} />
          </div>
          <Card>
            <table className="table">
              <thead>
                <tr>
                  <th>Предмет</th>
                  <th className="num">Кол-во</th>
                  <th className="num">Sell</th>
                  <th className="num">Buy</th>
                  <th className="num">м³</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.typeId}>
                    <td>
                      <TypeLink id={r.typeId} fallback={r.name} />
                    </td>
                    <td className="num">{fmtNum(r.qty)}</td>
                    <td className="num">{fmtIsk(r.sell, true)}</td>
                    <td className="num">{fmtIsk(r.buy, true)}</td>
                    <td className="num">{fmtNum(r.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  )
}

// ---------------- My orders ----------------

interface CharOrder {
  order_id: number
  type_id: number
  is_buy_order?: boolean
  price: number
  volume_remain: number
  volume_total: number
  location_id: number
  issued: string
  duration: number
}

function MyOrders() {
  const { active } = useApp()
  const { data, error, loading } = useAsync(async () => {
    if (!active) return null
    const orders = await esi<CharOrder[]>(`/characters/${active.id}/orders/`, { characterId: active.id })
    const names = await resolveLocations(orders.map((o) => o.location_id), active.id)
    const prices = new Map<number, Price>()
    // Compare against the market at each order's station when it is a known hub.
    for (const hub of HUBS) {
      const here = orders.filter((o) => o.location_id === hub.stationId)
      if (!here.length) continue
      const p = await hubPrices(hub.stationId, here.map((o) => o.type_id))
      here.forEach((o) => p.has(o.type_id) && prices.set(o.order_id, p.get(o.type_id)!))
    }
    return { orders, names, prices }
  }, [active?.id])

  if (!active) return <RequireLogin what="свои ордера" />
  if (loading) return <Loading />
  if (!data) return <ErrorBox error={error} />
  if (!data.orders.length) return <Empty>Активных ордеров нет.</Empty>

  return (
    <Card>
      <table className="table">
        <thead>
          <tr>
            <th>Предмет</th>
            <th>Тип</th>
            <th className="num">Цена</th>
            <th className="num">Лучшая на рынке</th>
            <th className="num">Осталось</th>
            <th>Где</th>
          </tr>
        </thead>
        <tbody>
          {data.orders.map((o) => {
            const p = data.prices.get(o.order_id)
            const best = p ? (o.is_buy_order ? p.buy.best : p.sell.best) : null
            const outbid = best != null && (o.is_buy_order ? best > o.price : best < o.price)
            return (
              <tr key={o.order_id}>
                <td>
                  <TypeLink id={o.type_id} />
                </td>
                <td>{o.is_buy_order ? 'Покупка' : 'Продажа'}</td>
                <td className="num">{fmtIsk(o.price)}</td>
                <td className={`num ${outbid ? 'bad' : ''}`}>{best == null ? '—' : fmtIsk(best)}</td>
                <td className="num">
                  {fmtNum(o.volume_remain)} / {fmtNum(o.volume_total)}
                </td>
                <td className="muted">
                  <LocationName id={o.location_id} name={data.names.get(o.location_id) ?? 'Структура'} characterId={active.id} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted small">Красным — ваш ордер перебит (данные хабов обновляются раз в несколько минут).</p>
    </Card>
  )
}
