import { useState } from 'react'
import { TypeLink } from '../../components/TypeLink'
import { Card, Empty, Loading, Stat } from '../../components/ui'
import { esi, resolveLocations } from '../../lib/esi'
import { fmtNum } from '../../lib/format'
import { getBasic, useTypeBasics } from '../../lib/sde'
import { useAsync } from '../../lib/useAsync'
import { ScopeHint } from '.'

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

export default function Blueprints({ id }: { id: number }) {
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState<'all' | 'bpo' | 'bpc'>('all')
  const { data, error, loading } = useAsync(async () => {
    const bps = await esi<Blueprint[]>(`/characters/${id}/blueprints/`, { characterId: id, allPages: true })
    // Blueprints inside containers point at the container; show the station when we can.
    const locations = await resolveLocations(bps.map((b) => b.location_id), id)
    return { bps, locations }
  }, [id])
  useTypeBasics(data?.bps.map((b) => b.type_id) ?? [])

  if (loading) return <Loading />
  if (error || !data) return <ScopeHint scope="esi-characters.read_blueprints.v1" />

  const f = filter.trim().toLowerCase()
  const list = data.bps
    .filter((b) => kind === 'all' || (kind === 'bpo' ? b.runs === -1 : b.runs !== -1))
    .filter((b) => !f || !!getBasic(b.type_id)?.n.some((n) => n.toLowerCase().includes(f)))
    .sort((a, b) => (getBasic(a.type_id)?.n[0] ?? '').localeCompare(getBasic(b.type_id)?.n[0] ?? ''))
  const bpo = data.bps.filter((b) => b.runs === -1).length

  return (
    <>
      <div className="stats-row">
        <Stat label="Оригиналов (BPO)" value={bpo} />
        <Stat label="Копий (BPC)" value={data.bps.length - bpo} />
      </div>
      <div className="toolbar">
        <input placeholder="Фильтр…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">Все</option>
          <option value="bpo">Только оригиналы</option>
          <option value="bpc">Только копии</option>
        </select>
      </div>
      <Card>
        {!list.length ? (
          <Empty>Чертежей нет</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Чертёж</th>
                <th>Тип</th>
                <th className="num">ME</th>
                <th className="num">TE</th>
                <th className="num">Прогонов</th>
                <th>Где</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.item_id}>
                  <td>
                    <TypeLink id={b.type_id} />
                  </td>
                  <td>{b.runs === -1 ? <span className="meta-badge">BPO</span> : <span className="meta-badge bpc">BPC</span>}</td>
                  <td className="num">{b.material_efficiency}%</td>
                  <td className="num">{b.time_efficiency}%</td>
                  <td className="num">{b.runs === -1 ? '∞' : fmtNum(b.runs)}</td>
                  <td className="muted small">{data.locations.get(b.location_id) ?? 'в контейнере'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}
