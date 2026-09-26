import { useState } from 'react'
import { useLang } from '../../AppContext'
import { FitView, type FitItem } from '../../components/FitView'
import { TypeLink } from '../../components/TypeLink'
import { Card, Empty, ErrorBox, Loading } from '../../components/ui'
import { esi } from '../../lib/esi'
import { getBasic, requestBasics, tn } from '../../lib/sde'
import { useAsync } from '../../lib/useAsync'
import { ScopeHint } from '.'

interface Asset {
  item_id: number
  type_id: number
  location_id: number
  location_flag: string
  quantity: number
}

interface Fitting {
  fitting_id: number
  name: string
  description: string
  ship_type_id: number
  items: { type_id: number; flag: string | number; quantity: number }[]
}

export default function Fittings({ id }: { id: number }) {
  const lang = useLang()
  const [openFit, setOpenFit] = useState<number | null>(null)
  const [filter, setFilter] = useState('')

  const current = useAsync(async () => {
    const ship = await esi<{ ship_type_id: number; ship_name: string; ship_item_id: number }>(`/characters/${id}/ship/`, { characterId: id })
    const assets = await esi<Asset[]>(`/characters/${id}/assets/`, { characterId: id, allPages: true }).catch(() => null)
    const items: FitItem[] | null = assets
      ? assets.filter((a) => a.location_id === ship.ship_item_id).map((a) => ({ typeId: a.type_id, flag: a.location_flag, qty: a.quantity }))
      : null
    return { ship, items }
  }, [id])

  const saved = useAsync(async () => {
    const fits = await esi<Fitting[]>(`/characters/${id}/fittings/`, { characterId: id })
    requestBasics(fits.map((f) => f.ship_type_id))
    return fits
  }, [id])

  const f = filter.trim().toLowerCase()
  const fits = (saved.data ?? []).filter((fit) => {
    if (!f) return true
    const ship = getBasic(fit.ship_type_id)
    return fit.name.toLowerCase().includes(f) || !!ship?.n.some((n) => n.toLowerCase().includes(f))
  })

  return (
    <>
      <Card title="Текущий корабль">
        {current.loading ? (
          <Loading />
        ) : current.error ? (
          <ErrorBox error={current.error} />
        ) : current.data ? (
          current.data.items ? (
            <FitView shipTypeId={current.data.ship.ship_type_id} name={current.data.ship.ship_name} items={current.data.items} />
          ) : (
            <>
              <TypeLink id={current.data.ship.ship_type_id} /> <span className="muted">{current.data.ship.ship_name}</span>
              <ScopeHint scope="esi-assets.read_assets.v1" />
            </>
          )
        ) : null}
        <p className="muted small">Фит берётся из ассетов; ESI обновляет их с задержкой до часа.</p>
      </Card>

      <Card
        title={`Сохранённые фиты${saved.data ? ` (${saved.data.length})` : ''}`}
        actions={<input placeholder="Фильтр по кораблю или названию…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      >
        {saved.loading ? (
          <Loading />
        ) : saved.error ? (
          <ScopeHint scope="esi-fittings.read_fittings.v1" />
        ) : !fits.length ? (
          <Empty>Фитов нет</Empty>
        ) : (
          <table className="table">
            <tbody>
              {fits.map((fit) => (
                <FitRow key={fit.fitting_id} fit={fit} open={openFit === fit.fitting_id} onToggle={() => setOpenFit(openFit === fit.fitting_id ? null : fit.fitting_id)} lang={lang} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}

function FitRow({ fit, open, onToggle, lang }: { fit: Fitting; open: boolean; onToggle: () => void; lang: 0 | 1 }) {
  const ship = getBasic(fit.ship_type_id)
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>
          {open ? '▾' : '▸'} <TypeLink id={fit.ship_type_id} />
        </td>
        <td>{fit.name}</td>
        <td className="muted small">{ship ? tn(ship.n, lang) : ''}</td>
        <td className="num muted">{fit.items.length} предм.</td>
      </tr>
      {open && (
        <tr className="sub-row">
          <td colSpan={4}>
            {fit.description && <p className="muted small">{fit.description}</p>}
            <FitView shipTypeId={fit.ship_type_id} name={fit.name} items={fit.items.map((i) => ({ typeId: i.type_id, flag: i.flag, qty: i.quantity }))} />
          </td>
        </tr>
      )}
    </>
  )
}
