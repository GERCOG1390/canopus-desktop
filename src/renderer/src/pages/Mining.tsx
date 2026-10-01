// Mining ledger of every logged-in character (ESI keeps the last 30 days): by day, by ore, by
// character and by system, valued at the best Jita buy order — what the ore sells for right away.

import { useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, Stat } from '../components/ui'
import { esi, systemInfo } from '../lib/esi'
import { fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { useAsync } from '../lib/useAsync'

const SCOPE = 'esi-industry.read_character_mining.v1'

interface Entry {
  date: string
  character: number
  system: number
  type: number
  quantity: number
}

type View = 'day' | 'ore' | 'character' | 'system'

export default function Mining() {
  const { characters } = useApp()
  const miners = characters.filter((c) => c.scopes.includes(SCOPE))
  const [days, setDays] = useState(30)
  const [view, setView] = useState<View>('ore')

  const ledger = useAsync(async () => {
    const rows = await Promise.all(
      miners.map(async (c) => {
        const r = await esi<{ date: string; solar_system_id: number; type_id: number; quantity: number }[]>(`/characters/${c.id}/mining/`, { characterId: c.id }).catch(() => [])
        return r.map((x): Entry => ({ date: x.date, character: c.id, system: x.solar_system_id, type: x.type_id, quantity: x.quantity }))
      })
    )
    const entries = rows.flat()
    const types = [...new Set(entries.map((e) => e.type))]
    const [prices, basics] = await Promise.all([jitaPrices(types), window.api.sde.basics(types)])
    const systems = new Map(await Promise.all([...new Set(entries.map((e) => e.system))].map(async (id) => [id, (await systemInfo(id).catch(() => null))?.name ?? String(id)] as const)))
    return { entries, prices, basics, systems }
  }, [miners.map((c) => c.id).join(',')])

  const d = ledger.data
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const shown = useMemo(() => (d?.entries ?? []).filter((e) => e.date >= since), [d, since])
  const unit = (type: number) => d?.prices.get(type)?.buy.best ?? 0
  const vol = (type: number) => d?.basics[type]?.v ?? 0
  const total = shown.reduce((a, e) => ({ isk: a.isk + e.quantity * unit(e.type), m3: a.m3 + e.quantity * vol(e.type) }), { isk: 0, m3: 0 })

  const groups = useMemo(() => {
    const key = (e: Entry) => (view === 'day' ? e.date : view === 'ore' ? e.type : view === 'character' ? e.character : e.system)
    const map = new Map<string | number, { units: number; m3: number; isk: number }>()
    for (const e of shown) {
      const g = map.get(key(e)) ?? { units: 0, m3: 0, isk: 0 }
      g.units += e.quantity
      g.m3 += e.quantity * vol(e.type)
      g.isk += e.quantity * unit(e.type)
      map.set(key(e), g)
    }
    return [...map].sort((a, b) => (view === 'day' ? String(b[0]).localeCompare(String(a[0])) : b[1].isk - a[1].isk))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, view])

  if (!characters.length) return <Empty>Войдите персонажами через EVE SSO, чтобы видеть журнал добычи.</Empty>
  if (!miners.length) return <Empty>Персонажам не хватает разрешения на журнал добычи — войдите ими заново в «Настройках».</Empty>
  if (ledger.loading && !d) return <Loading />
  if (ledger.error) return <ErrorBox error={ledger.error} />
  const activeDays = new Set(shown.map((e) => e.date)).size
  const name = (k: string | number) => {
    if (view === 'day') return String(k)
    if (view === 'ore') return <TypeLink id={Number(k)} />
    if (view === 'character') return <span translate="no">{characters.find((c) => c.id === k)?.name ?? k}</span>
    return <span translate="no">{d?.systems.get(Number(k)) ?? k}</span>
  }

  return (
    <>
      <div className="stats-row">
        <Stat label="Добыто, ISK (Jita, покупка)" value={fmtIsk(total.isk, true)} />
        <Stat label="Объём" value={`${fmtNum(Math.round(total.m3))} m³`} />
        <Stat label="Дней с добычей" value={String(activeDays)} sub={activeDays ? `в среднем ${fmtIsk(total.isk / activeDays, true)} в день` : undefined} />
      </div>
      <Card
        title="Журнал добычи"
        actions={
          <>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>Сегодня</option>
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
            </select>
            <select value={view} onChange={(e) => setView(e.target.value as View)}>
              <option value="ore">По руде</option>
              <option value="day">По дням</option>
              <option value="character">По персонажам</option>
              <option value="system">По системам</option>
            </select>
            <button className="ghost" onClick={ledger.reload}>
              Обновить
            </button>
          </>
        }
      >
        {!shown.length ? (
          <Empty>За этот период добычи нет.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{view === 'day' ? 'День' : view === 'ore' ? 'Руда' : view === 'character' ? 'Персонаж' : 'Система'}</th>
                <th className="num">Единиц</th>
                <th className="num">m³</th>
                <th className="num">ISK</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([k, g]) => (
                <tr key={String(k)}>
                  <td>{name(k)}</td>
                  <td className="num">{fmtNum(g.units)}</td>
                  <td className="num">{fmtNum(Math.round(g.m3))}</td>
                  <td className="num">{fmtIsk(g.isk, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">ESI хранит журнал добычи за последние 30 дней и обновляет его раз в несколько часов. Стоимость — сырой руды по лучшему ордеру на покупку в Jita.</p>
      </Card>
    </>
  )
}
