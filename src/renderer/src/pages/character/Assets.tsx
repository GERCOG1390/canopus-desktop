import { useMemo, useState } from 'react'
import { LocationName } from '../../components/LocationName'
import { TypeLink } from '../../components/TypeLink'
import { Card, ErrorBox, Loading, Stat } from '../../components/ui'
import { esi, resolveLocations } from '../../lib/esi'
import { fmtIsk, fmtNum } from '../../lib/format'
import { jitaPrices } from '../../lib/market'
import { getBasic, useTypeBasics } from '../../lib/sde'
import { useAsync } from '../../lib/useAsync'

interface Asset {
  item_id: number
  type_id: number
  location_id: number
  location_type: string
  location_flag: string
  quantity: number
  is_singleton: boolean
  is_blueprint_copy?: boolean
}

interface LocationGroup {
  id: number
  name: string
  items: Map<number, { typeId: number; qty: number; value: number }>
  value: number
  count: number
}

export default function Assets({ id }: { id: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const [filter, setFilter] = useState('')

  const { data, error, loading } = useAsync(async () => {
    const assets = await esi<Asset[]>(`/characters/${id}/assets/`, { characterId: id, allPages: true })
    const byItem = new Map(assets.map((a) => [a.item_id, a]))
    const rootOf = (a: Asset): number => {
      let cur = a
      for (let guard = 0; guard < 10 && byItem.has(cur.location_id); guard++) cur = byItem.get(cur.location_id)!
      return cur.location_id
    }
    const prices = await jitaPrices(assets.map((a) => a.type_id))
    const groups = new Map<number, LocationGroup>()
    for (const a of assets) {
      const root = rootOf(a)
      const g = groups.get(root) ?? { id: root, name: '', items: new Map(), value: 0, count: 0 }
      const unit = a.is_blueprint_copy ? 0 : prices.get(a.type_id)?.sell.best ?? 0
      const it = g.items.get(a.type_id) ?? { typeId: a.type_id, qty: 0, value: 0 }
      it.qty += a.quantity
      it.value += unit * a.quantity
      g.items.set(a.type_id, it)
      g.value += unit * a.quantity
      g.count += 1
      groups.set(root, g)
    }
    const names = await resolveLocations(groups.keys(), id)
    for (const g of groups.values()) g.name = names.get(g.id) ?? `Локация ${g.id}`
    const list = [...groups.values()].sort((a, b) => b.value - a.value)
    return { list, total: list.reduce((s, g) => s + g.value, 0), count: assets.length, typeIds: [...new Set(assets.map((a) => a.type_id))] }
  }, [id])
  // Names are needed for filtering by item, so load them all up front.
  useTypeBasics(data?.typeIds ?? [])

  const f = filter.trim().toLowerCase()
  const matches = (typeId: number) => !!getBasic(typeId)?.n.some((n) => n.toLowerCase().includes(f))
  const visible = useMemo(
    () => (data?.list ?? []).filter((g) => !f || g.name.toLowerCase().includes(f) || [...g.items.keys()].some(matches)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, f]
  )

  if (loading) return <Loading label="Загрузка ассетов и цен…" />
  if (!data) return <ErrorBox error={error} />

  return (
    <>
      <div className="stats-row">
        <Stat label="Оценка (Jita sell)" value={fmtIsk(data.total, true)} sub="без учёта копий чертежей" />
        <Stat label="Предметов (стеков)" value={fmtNum(data.count)} />
        <Stat label="Локаций" value={fmtNum(data.list.length)} />
      </div>
      <div className="toolbar">
        <input placeholder="Поиск по локации или предмету (рус/англ)…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Локация</th>
              <th className="num">Стеков</th>
              <th className="num">Оценка</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => {
              const isOpen = open === g.id || (!!f && visible.length <= 3)
              const items = [...g.items.values()].filter((i) => !f || g.name.toLowerCase().includes(f) || matches(i.typeId)).sort((a, b) => b.value - a.value)
              return (
                <LocationRows key={g.id} characterId={id} group={g} items={items} open={isOpen} onToggle={() => setOpen(open === g.id ? null : g.id)} />
              )
            })}
          </tbody>
        </table>
      </Card>
    </>
  )
}

function LocationRows({ characterId, group, items, open, onToggle }: { characterId: number; group: LocationGroup; items: { typeId: number; qty: number; value: number }[]; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>
          {open ? '▾' : '▸'} <LocationName id={group.id} name={group.name} characterId={characterId} />
        </td>
        <td className="num">{fmtNum(group.count)}</td>
        <td className="num">{fmtIsk(group.value, true)}</td>
      </tr>
      {open &&
        items.slice(0, 500).map((i) => (
          <tr key={i.typeId} className="sub-row">
            <td>
              <TypeLink id={i.typeId} />
            </td>
            <td className="num">{fmtNum(i.qty)}</td>
            <td className="num">{fmtIsk(i.value, true)}</td>
          </tr>
        ))}
    </>
  )
}
