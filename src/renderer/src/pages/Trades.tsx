// Trades and real profit: buys and sells from the wallet transactions of the chosen characters,
// each sell matched to earlier buys of the same item (first in, first out), sales tax and broker
// fees from the wallet journal, and what is left unsold valued at Jita.

import { useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, RequireLogin, Stat } from '../components/ui'
import { esi } from '../lib/esi'
import { fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { useAsync } from '../lib/useAsync'

const SCOPE = 'esi-wallet.read_character_wallet.v1'

interface Tx {
  transaction_id: number
  date: string
  type_id: number
  quantity: number
  unit_price: number
  is_buy: boolean
  is_personal: boolean
}

interface Journal {
  date: string
  ref_type: string
  amount?: number
}

interface ItemResult {
  type: number
  bought: number
  boughtIsk: number
  sold: number
  soldIsk: number
  /** Units sold that were matched to a buy */
  matched: number
  profit: number
  /** Bought and not sold yet */
  left: number
  leftCost: number
}

/** Older transactions: ESI gives the newest 2500 and pages back with from_id. */
async function transactions(id: number): Promise<Tx[]> {
  const out: Tx[] = []
  let from: number | undefined
  for (let page = 0; page < 6; page++) {
    const batch = await esi<Tx[]>(`/characters/${id}/wallet/transactions/${from ? `?from_id=${from}` : ''}`, { characterId: id })
    const fresh = batch.filter((t) => !out.some((o) => o.transaction_id === t.transaction_id))
    if (!fresh.length) break
    out.push(...fresh)
    from = Math.min(...fresh.map((t) => t.transaction_id)) - 1
  }
  return out
}

/** Sells matched to earlier buys of the same item, oldest buys first. */
function profitByItem(txs: Tx[], since: number): ItemResult[] {
  const byType = new Map<number, Tx[]>()
  for (const t of txs) (byType.get(t.type_id) ?? byType.set(t.type_id, []).get(t.type_id)!).push(t)
  const out: ItemResult[] = []
  for (const [type, list] of byType) {
    list.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.transaction_id - b.transaction_id)
    // Buys from before the period still count as the cost of what is sold within it.
    const lots: { qty: number; price: number }[] = []
    const r: ItemResult = { type, bought: 0, boughtIsk: 0, sold: 0, soldIsk: 0, matched: 0, profit: 0, left: 0, leftCost: 0 }
    for (const t of list) {
      const inPeriod = Date.parse(t.date) >= since
      if (t.is_buy) {
        lots.push({ qty: t.quantity, price: t.unit_price })
        if (inPeriod) {
          r.bought += t.quantity
          r.boughtIsk += t.quantity * t.unit_price
        }
        continue
      }
      let qty = t.quantity
      while (qty > 0 && lots.length) {
        const lot = lots[0]
        const n = Math.min(qty, lot.qty)
        if (inPeriod) {
          r.matched += n
          r.profit += n * (t.unit_price - lot.price)
        }
        lot.qty -= n
        qty -= n
        if (!lot.qty) lots.shift()
      }
      if (inPeriod) {
        r.sold += t.quantity
        r.soldIsk += t.quantity * t.unit_price
      }
    }
    r.left = lots.reduce((a, l) => a + l.qty, 0)
    r.leftCost = lots.reduce((a, l) => a + l.qty * l.price, 0)
    if (r.bought || r.sold) out.push(r)
  }
  return out
}

export default function Trades() {
  const { active, characters } = useApp()
  const [everyone, setEveryone] = useState(false)
  const [days, setDays] = useState(30)
  const [view, setView] = useState<'profit' | 'stock'>('profit')
  const ids = (everyone ? characters : active ? [active] : []).filter((c) => c.scopes.includes(SCOPE)).map((c) => c.id)

  const data = useAsync(async () => {
    const per = await Promise.all(
      ids.map(async (id) => {
        const [txs, journal] = await Promise.all([
          transactions(id).catch(() => [] as Tx[]),
          esi<Journal[]>(`/characters/${id}/wallet/journal/`, { characterId: id, allPages: true }).catch(() => [] as Journal[])
        ])
        return { txs: txs.filter((t) => t.is_personal), journal }
      })
    )
    return { txs: per.flatMap((p) => p.txs), journal: per.flatMap((p) => p.journal) }
  }, [ids.join(',')])

  const since = Date.now() - days * 86400_000
  const items = useMemo(() => (data.data ? profitByItem(data.data.txs, since) : []), [data.data, since])
  const fees = useMemo(() => {
    const j = (data.data?.journal ?? []).filter((e) => Date.parse(e.date) >= since)
    const sum = (type: string) => -j.filter((e) => e.ref_type === type).reduce((a, e) => a + (e.amount ?? 0), 0)
    return { tax: sum('transaction_tax'), broker: sum('brokers_fee') }
  }, [data.data, since])
  const stockTypes = items.filter((i) => i.left > 0).map((i) => i.type)
  const prices = useAsync(async () => (stockTypes.length ? jitaPrices(stockTypes) : new Map()), [stockTypes.join(',')])

  if (!active) return <RequireLogin what="сделки" />
  if (!ids.length) return <Empty>Нужен доступ к кошельку — войдите персонажем заново в «Настройках».</Empty>
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} />

  const gross = items.reduce((a, i) => a + i.profit, 0)
  const net = gross - fees.tax - fees.broker
  const turnover = items.reduce((a, i) => a + i.soldIsk, 0)
  const stock = items.filter((i) => i.left > 0)
  const stockValue = stock.reduce((a, i) => a + i.left * ((prices.data?.get(i.type)?.sell.best as number | undefined) ?? 0), 0)
  const rows = view === 'profit' ? items.filter((i) => i.matched).sort((a, b) => b.profit - a.profit) : stock.sort((a, b) => b.leftCost - a.leftCost)

  return (
    <>
      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 дней</option>
          <option value={30}>30 дней</option>
          <option value={90}>90 дней</option>
        </select>
        <select value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="profit">Прибыль по предметам</option>
          <option value="stock">Не продано</option>
        </select>
        {characters.length > 1 && (
          <label className="check">
            <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
            Все персонажи
          </label>
        )}
        {data.loading && <span className="muted small">Обновляю…</span>}
      </div>
      <div className="stats-row">
        <Stat label="Чистая прибыль" value={fmtIsk(net, true)} sub={`с продаж ${fmtIsk(gross, true)} минус налоги и комиссии`} />
        <Stat label="Оборот (продажи)" value={fmtIsk(turnover, true)} sub={turnover ? `маржа ${((gross / turnover) * 100).toFixed(1)}%` : undefined} />
        <Stat label="Налог с продаж" value={fmtIsk(fees.tax, true)} />
        <Stat label="Брокерские комиссии" value={fmtIsk(fees.broker, true)} />
        <Stat label="Не продано" value={fmtIsk(stock.reduce((a, i) => a + i.leftCost, 0), true)} sub={stockValue ? `в Jita ${fmtIsk(stockValue, true)}` : undefined} />
      </div>
      <Card>
        {!rows.length ? (
          <Empty>{view === 'profit' ? 'За этот период продаж с известной ценой покупки нет.' : 'Всё купленное продано.'}</Empty>
        ) : view === 'profit' ? (
          <table className="table">
            <thead>
              <tr>
                <th>Предмет</th>
                <th className="num">Продано</th>
                <th className="num">Средняя продажа</th>
                <th className="num">Прибыль за шт.</th>
                <th className="num">Прибыль</th>
                <th className="num">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const avgSell = i.sold ? i.soldIsk / i.sold : 0
                const perUnit = i.matched ? i.profit / i.matched : 0
                return (
                  <tr key={i.type}>
                    <td>
                      <TypeLink id={i.type} />
                    </td>
                    <td className="num">{fmtNum(i.sold)}</td>
                    <td className="num">{fmtIsk(avgSell, true)}</td>
                    <td className={`num ${perUnit < 0 ? 'bad' : ''}`}>{fmtIsk(perUnit, true)}</td>
                    <td className={`num ${i.profit < 0 ? 'bad' : 'good'}`}>{fmtIsk(i.profit, true)}</td>
                    <td className="num">{avgSell ? `${((perUnit / avgSell) * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Предмет</th>
                <th className="num">Осталось</th>
                <th className="num">Средняя покупка</th>
                <th className="num">Вложено</th>
                <th className="num">Сейчас в Jita</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const jita = (prices.data?.get(i.type)?.sell.best as number | undefined) ?? 0
                return (
                  <tr key={i.type}>
                    <td>
                      <TypeLink id={i.type} />
                    </td>
                    <td className="num">{fmtNum(i.left)}</td>
                    <td className="num">{fmtIsk(i.leftCost / i.left, true)}</td>
                    <td className="num">{fmtIsk(i.leftCost, true)}</td>
                    <td className={`num ${jita && jita * i.left < i.leftCost ? 'bad' : ''}`}>{jita ? fmtIsk(jita * i.left, true) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Продажи сопоставляются с более ранними покупками того же предмета (сначала самые старые). ESI отдаёт около трёх месяцев транзакций: товар, купленный раньше, не
          попадёт в расчёт. Налоги и комиссии — из журнала кошелька.
        </p>
      </Card>
    </>
  )
}
