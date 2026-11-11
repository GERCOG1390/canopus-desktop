// Price alerts at Jita: an item, its best sell or buy order, and a line to watch. The notifier in the main
// process checks them with the other background timers, and posts to the tray (and Discord if asked).

import { useState } from 'react'
import { useApp, useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, SearchBox } from '../components/ui'
import { fmtIsk } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { searchTypesSde } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { isTriggered, type PriceAlert } from '../../../shared/priceAlerts'

export default function PriceAlerts() {
  const { settings, updateSettings } = useApp()
  const lang = useLang()
  const [item, setItem] = useState<{ id: number; name: string } | null>(null)
  const [side, setSide] = useState<PriceAlert['side']>('sell')
  const [dir, setDir] = useState<PriceAlert['dir']>('below')
  const [price, setPrice] = useState(0)
  const notify = settings?.notify
  const alerts = notify?.priceAlerts ?? []
  const ids = [...alerts.map((a) => a.typeId), ...(item ? [item.id] : [])]
  const prices = useAsync(async () => (ids.length ? jitaPrices(ids) : new Map()), [ids.join(',')])
  const best = (typeId: number, s: PriceAlert['side']): number => prices.data?.get(typeId)?.[s].best ?? 0

  if (!notify) return null
  const save = (next: PriceAlert[]) => void updateSettings({ notify: { ...notify, priceAlerts: next } })
  const add = () => {
    if (!item || price <= 0) return
    save([...alerts, { id: `${item.id}-${Date.now()}`, typeId: item.id, name: item.name, side, dir, price }])
    setItem(null)
    setPrice(0)
  }

  return (
    <>
      <Card title="Новое оповещение">
        <div className="calc-form">
          <label className="wide">
            Предмет
            <SearchBox
              key={item ? 'picked' : 'empty'}
              placeholder="PLEX, Tritanium…"
              search={(q) => searchTypesSde(q, lang, { marketOnly: true })}
              onSelect={setItem}
              initial={item?.name ?? ''}
            />
          </label>
          <label>
            Сторона
            <select value={side} onChange={(e) => setSide(e.target.value as PriceAlert['side'])}>
              <option value="sell">Лучшая продажа</option>
              <option value="buy">Лучшая покупка</option>
            </select>
          </label>
          <label>
            Условие
            <select value={dir} onChange={(e) => setDir(e.target.value as PriceAlert['dir'])}>
              <option value="below">Упадёт до</option>
              <option value="above">Вырастет до</option>
            </select>
          </label>
          <label>
            Порог, ISK
            <input type="number" min={0} step="any" value={price || ''} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            Сейчас
            <input readOnly value={item ? fmtIsk(best(item.id, side), true) : '—'} />
          </label>
        </div>
        <button disabled={!item || price <= 0} onClick={add}>
          Добавить
        </button>
      </Card>
      <Card title="Оповещения">
        {!alerts.length ? (
          <Empty>Оповещений нет. Добавьте предмет и порог цены.</Empty>
        ) : (
          <table className="table compact">
            <thead>
              <tr>
                <th>Предмет</th>
                <th>Сторона</th>
                <th>Условие</th>
                <th className="num">Порог, ISK</th>
                <th className="num">Сейчас</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => {
                const now = best(a.typeId, a.side)
                return (
                  <tr key={a.id}>
                    <td>
                      <TypeLink id={a.typeId} size={20} />
                    </td>
                    <td className="muted small">{a.side === 'sell' ? 'Лучшая продажа' : 'Лучшая покупка'}</td>
                    <td className="muted small">{a.dir === 'below' ? 'Упадёт до' : 'Вырастет до'}</td>
                    <td className="num">{fmtIsk(a.price, true)}</td>
                    <td className="num">{now ? fmtIsk(now, true) : '—'}</td>
                    <td className="num">{isTriggered(a, now) ? <span className="good">Сработало</span> : <span className="muted">Ждём</span>}</td>
                    <td className="num">
                      <button className="ghost small danger row-action" onClick={() => save(alerts.filter((x) => x.id !== a.id))}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <label className="check">
          <input type="checkbox" checked={notify.priceAlertsDiscord} onChange={(e) => void updateSettings({ notify: { ...notify, priceAlertsDiscord: e.target.checked } })} /> Дублировать в Discord
          (вебхук разведки)
        </label>
        <p className="muted small">
          Цены Jita проверяются каждые 5 минут, пока Canopus запущен. Оповещение приходит один раз при достижении порога и снова срабатывает, когда цена уйдёт обратно и вернётся.
        </p>
      </Card>
    </>
  )
}
