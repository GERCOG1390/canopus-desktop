// The corporation's moon mining (esi-industry.read_corporation_mining.v1): extraction timers of
// the refineries (Station Manager role) and who mined what from the moons in the last 30 days
// (observer ledgers, Accountant role), valued at the best Jita buy order.

import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, RequireLogin, Stat } from '../components/ui'
import { esi, resolveNames } from '../lib/esi'
import { fmtDuration, fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { useAsync } from '../lib/useAsync'

const SCOPE = 'esi-industry.read_corporation_mining.v1'
const STRUCTURES_SCOPE = 'esi-corporations.read_structures.v1'

interface Extraction {
  structure_id: number
  moon_id: number
  extraction_start_time: string
  chunk_arrival_time: string
  natural_decay_time: string
}

interface LedgerRow {
  character_id: number
  type_id: number
  quantity: number
  last_updated: string
}

const roleError = (e: string, role: string) => (/403/.test(e) ? `ESI отказал: нужна роль ${role} в корпорации.` : e)

export default function Moons() {
  const { active } = useApp()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const corp = useAsync(async () => (active ? (await esi<{ corporation_id: number }>(`/characters/${active.id}/`)).corporation_id : null), [active?.id])

  const extractions = useAsync(async () => {
    if (!active || !corp.data || !active.scopes.includes(SCOPE)) return null
    const list = await esi<Extraction[]>(`/corporation/${corp.data}/mining/extractions/`, { characterId: active.id })
    // Refinery names from the structures list when that permission is there too.
    const structures = active.scopes.includes(STRUCTURES_SCOPE)
      ? await esi<{ structure_id: number; name?: string }[]>(`/corporations/${corp.data}/structures/`, { characterId: active.id }).catch(() => [])
      : []
    const names = new Map(structures.map((s) => [s.structure_id, s.name ?? `#${s.structure_id}`]))
    const moons = new Map(
      await Promise.all(list.map(async (e) => [e.moon_id, (await esi<{ name: string }>(`/universe/moons/${e.moon_id}/`).catch(() => ({ name: String(e.moon_id) }))).name] as const))
    )
    return list
      .map((e) => ({ ...e, structure: names.get(e.structure_id) ?? `#${e.structure_id}`, moon: moons.get(e.moon_id) ?? String(e.moon_id) }))
      .sort((a, b) => Date.parse(a.chunk_arrival_time) - Date.parse(b.chunk_arrival_time))
  }, [active?.id, corp.data, active?.scopes.join(' ')])

  const ledger = useAsync(async () => {
    if (!active || !corp.data || !active.scopes.includes(SCOPE)) return null
    const observers = await esi<{ observer_id: number }[]>(`/corporation/${corp.data}/mining/observers/`, { characterId: active.id, allPages: true })
    const rows = (
      await Promise.all(
        observers.map((o) => esi<LedgerRow[]>(`/corporation/${corp.data}/mining/observers/${o.observer_id}/`, { characterId: active.id, allPages: true }).catch(() => []))
      )
    ).flat()
    const [names, prices] = await Promise.all([resolveNames(rows.map((r) => r.character_id)), jitaPrices([...new Set(rows.map((r) => r.type_id))])])
    const by = <K,>(key: (r: LedgerRow) => K) => {
      const m = new Map<K, { units: number; isk: number }>()
      for (const r of rows) {
        const g = m.get(key(r)) ?? { units: 0, isk: 0 }
        g.units += r.quantity
        g.isk += r.quantity * (prices.get(r.type_id)?.buy.best ?? 0)
        m.set(key(r), g)
      }
      return [...m].sort((a, b) => b[1].isk - a[1].isk)
    }
    return { pilots: by((r) => r.character_id), ores: by((r) => r.type_id), names, total: rows.reduce((a, r) => a + r.quantity * (prices.get(r.type_id)?.buy.best ?? 0), 0) }
  }, [active?.id, corp.data, active?.scopes.join(' ')])

  if (!active) return <RequireLogin what="лунную добычу корпорации" />
  if (!active.scopes.includes(SCOPE)) return <Empty>Нажмите «Настройки → Разрешить корпорацию». Для таймеров нужна роль Station Manager, для журнала добычи — Accountant.</Empty>
  if (corp.loading) return <Loading />

  return (
    <>
      <Card title="Лунные экстракции">
        {extractions.loading && !extractions.data ? (
          <Loading />
        ) : extractions.error ? (
          <ErrorBox error={roleError(extractions.error, 'Station Manager')} />
        ) : !extractions.data?.length ? (
          <Empty>Активных экстракций нет.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Рефайнери</th>
                <th>Луна</th>
                <th>Чанк прилетит</th>
                <th>Взорвётся сам</th>
              </tr>
            </thead>
            <tbody>
              {extractions.data.map((e) => {
                const arrival = Date.parse(e.chunk_arrival_time) - now
                const decay = Date.parse(e.natural_decay_time) - now
                return (
                  <tr key={e.structure_id}>
                    <td translate="no">{e.structure}</td>
                    <td translate="no">{e.moon}</td>
                    <td>{arrival > 0 ? fmtDuration(arrival) : <span className="good">Готов</span>}</td>
                    <td>{decay > 0 ? fmtDuration(decay) : <span className="muted">уже</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {ledger.loading && !ledger.data ? (
        <Loading />
      ) : ledger.error ? (
        <ErrorBox error={roleError(ledger.error, 'Accountant')} />
      ) : ledger.data ? (
        <>
          <div className="stats-row">
            <Stat label="Добыто с лун за 30 дней (Jita, покупка)" value={fmtIsk(ledger.data.total, true)} />
            <Stat label="Пилотов" value={ledger.data.pilots.length} />
          </div>
          <div className="two-col">
            <Card title="По пилотам">
              <table className="table">
                <tbody>
                  {ledger.data.pilots.map(([id, g]) => (
                    <tr key={id}>
                      <td translate="no">{ledger.data!.names.get(id) ?? id}</td>
                      <td className="num">{fmtNum(g.units)}</td>
                      <td className="num">{fmtIsk(g.isk, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="По руде">
              <table className="table">
                <tbody>
                  {ledger.data.ores.map(([id, g]) => (
                    <tr key={id}>
                      <td>
                        <TypeLink id={id} />
                      </td>
                      <td className="num">{fmtNum(g.units)}</td>
                      <td className="num">{fmtIsk(g.isk, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      ) : null}
    </>
  )
}
