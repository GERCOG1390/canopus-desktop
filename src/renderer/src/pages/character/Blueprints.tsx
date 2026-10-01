// Blueprint library: the active character's blueprints or every logged-in character's at once,
// searchable by the blueprint or by what it makes ("do I have a blueprint for X?"), originals and
// copies, ME / TE / runs, where it is; identical copies in one place are counted on one row.

import { useState } from 'react'
import { useApp } from '../../AppContext'
import { TypeLink } from '../../components/TypeLink'
import { Card, Empty, Loading, Stat } from '../../components/ui'
import { esi, resolveLocations } from '../../lib/esi'
import { LocationName } from '../../components/LocationName'
import { fmtNum } from '../../lib/format'
import { getBasic, useTypeBasics } from '../../lib/sde'
import { useAsync } from '../../lib/useAsync'
import { ScopeHint } from '.'

const SCOPE = 'esi-characters.read_blueprints.v1'

interface Blueprint {
  item_id: number
  type_id: number
  location_id: number
  location_flag: string
  material_efficiency: number
  time_efficiency: number
  /** -1 for originals */
  runs: number
  quantity: number
}

interface Row extends Blueprint {
  character: number
  /** Identical blueprints in the same place */
  count: number
}

export default function Blueprints({ id }: { id: number }) {
  const { characters } = useApp()
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState<'all' | 'bpo' | 'bpc'>('all')
  const [everyone, setEveryone] = useState(false)
  const owners = everyone ? characters.filter((c) => c.scopes.includes(SCOPE)).map((c) => c.id) : [id]

  const { data, error, loading } = useAsync(async () => {
    const perChar = await Promise.all(
      owners.map(async (cid) => {
        const bps = await esi<Blueprint[]>(`/characters/${cid}/blueprints/`, { characterId: cid, allPages: true })
        // Blueprints inside containers point at the container; show the station when we can.
        const locations = await resolveLocations(bps.map((b) => b.location_id), cid)
        return { cid, bps, locations }
      })
    )
    const groups = new Map<string, Row>()
    for (const { cid, bps } of perChar)
      for (const b of bps) {
        const key = [cid, b.type_id, b.material_efficiency, b.time_efficiency, b.runs, b.location_id].join(':')
        const g = groups.get(key)
        if (g) g.count++
        else groups.set(key, { ...b, character: cid, count: 1 })
      }
    const rows = [...groups.values()]
    const products = await window.api.sde.blueprintProducts([...new Set(rows.map((r) => r.type_id))])
    const locations = new Map(perChar.map((p) => [p.cid, p.locations]))
    return { rows, products, locations }
  }, [owners.join(',')])
  useTypeBasics([...(data?.rows.map((b) => b.type_id) ?? []), ...Object.values(data?.products ?? {})])

  if (loading && !data) return <Loading />
  if (error || !data) return <ScopeHint scope={SCOPE} />

  const f = filter.trim().toLowerCase()
  const matches = (typeId: number | undefined) => !!typeId && !!getBasic(typeId)?.n.some((n) => n.toLowerCase().includes(f))
  const list = data.rows
    .filter((b) => kind === 'all' || (kind === 'bpo' ? b.runs === -1 : b.runs !== -1))
    .filter((b) => !f || matches(b.type_id) || matches(data.products[b.type_id]))
    .sort((a, b) => (getBasic(a.type_id)?.n[0] ?? '').localeCompare(getBasic(b.type_id)?.n[0] ?? ''))
  const bpo = data.rows.filter((b) => b.runs === -1).reduce((a, b) => a + b.count, 0)
  const bpc = data.rows.filter((b) => b.runs !== -1).reduce((a, b) => a + b.count, 0)
  const nameOf = (cid: number) => characters.find((c) => c.id === cid)?.name ?? String(cid)

  return (
    <>
      <div className="stats-row">
        <Stat label="Оригиналов (BPO)" value={bpo} />
        <Stat label="Копий (BPC)" value={bpc} />
        {everyone && <Stat label="Персонажей" value={owners.length} />}
      </div>
      <div className="toolbar">
        <input placeholder="Чертёж или что он производит…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">Все</option>
          <option value="bpo">Только оригиналы</option>
          <option value="bpc">Только копии</option>
        </select>
        {characters.length > 1 && (
          <label className="check">
            <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
            Все персонажи
          </label>
        )}
        {loading && <span className="muted small">Загрузка…</span>}
      </div>
      <Card>
        {!list.length ? (
          <Empty>{f ? 'Ничего не найдено' : 'Чертежей нет'}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Чертёж</th>
                <th>Производит</th>
                <th>Тип</th>
                <th className="num">ME</th>
                <th className="num">TE</th>
                <th className="num">Прогонов</th>
                <th className="num">Шт.</th>
                {everyone && <th>Персонаж</th>}
                <th>Где</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => {
                const loc = data.locations.get(b.character)
                return (
                  <tr key={`${b.character}-${b.item_id}`}>
                    <td>
                      <TypeLink id={b.type_id} />
                    </td>
                    <td>{data.products[b.type_id] ? <TypeLink id={data.products[b.type_id]} /> : <span className="muted">—</span>}</td>
                    <td>{b.runs === -1 ? <span className="meta-badge">BPO</span> : <span className="meta-badge bpc">BPC</span>}</td>
                    <td className="num">{b.material_efficiency}%</td>
                    <td className="num">{b.time_efficiency}%</td>
                    <td className="num">{b.runs === -1 ? '∞' : fmtNum(b.runs)}</td>
                    <td className="num">{b.count}</td>
                    {everyone && (
                      <td className="small" translate="no">
                        {nameOf(b.character)}
                      </td>
                    )}
                    <td className="muted small">
                      {loc?.has(b.location_id) ? <LocationName id={b.location_id} name={loc.get(b.location_id)!} characterId={b.character} /> : 'в контейнере'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}
