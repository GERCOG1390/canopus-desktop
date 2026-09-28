import { useState } from 'react'
import { useLang } from '../../AppContext'
import { FitView, type FitItem } from '../../components/FitView'
import { TypeLink } from '../../components/TypeLink'
import { Card, Empty, ErrorBox, Loading } from '../../components/ui'
import { esi } from '../../lib/esi'
import { groupByShip, loadGameFits, type GameFitting } from '../../lib/gameFits'
import { GameButton } from '../../components/GameButton'
import { deleteGameFit, SCOPE } from '../../lib/gameActions'
import { getBasic, tn, useTypeBasics } from '../../lib/sde'
import { useAsync } from '../../lib/useAsync'
import { ScopeHint } from '.'

interface Asset {
  item_id: number
  type_id: number
  location_id: number
  location_flag: string
  quantity: number
}

export default function Fittings({ id }: { id: number }) {
  const lang = useLang()
  const [openFit, setOpenFit] = useState<number | null>(null)
  const [openShips, setOpenShips] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState('')

  const current = useAsync(async () => {
    const ship = await esi<{ ship_type_id: number; ship_name: string; ship_item_id: number }>(`/characters/${id}/ship/`, { characterId: id })
    const assets = await esi<Asset[]>(`/characters/${id}/assets/`, { characterId: id, allPages: true }).catch(() => null)
    const items: FitItem[] | null = assets
      ? assets.filter((a) => a.location_id === ship.ship_item_id).map((a) => ({ typeId: a.type_id, flag: a.location_flag, qty: a.quantity }))
      : null
    return { ship, items }
  }, [id])

  // Bumped after a fit is deleted in the game: reload past the cache.
  const [version, setVersion] = useState(0)
  const saved = useAsync(() => loadGameFits(id, version > 0), [id, version])
  const onDeleted = () => setVersion((v) => v + 1)
  useTypeBasics(saved.data?.map((x) => x.ship_type_id) ?? [])

  const f = filter.trim().toLowerCase()
  const fits = (saved.data ?? []).filter((fit) => {
    if (!f) return true
    const ship = getBasic(fit.ship_type_id)
    return fit.name.toLowerCase().includes(f) || !!ship?.n.some((n) => n.toLowerCase().includes(f))
  })
  const groups = groupByShip(
    fits,
    (x) => x.ship_type_id,
    (x) => x.name,
    lang
  )
  const toggleShip = (ship: number) =>
    setOpenShips((prev) => {
      const next = new Set(prev)
      if (next.has(ship)) next.delete(ship)
      else next.add(ship)
      return next
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
          <table className="table ship-fit-groups">
            <tbody>
              {groups.map((g) => {
                // While filtering every matching hull is open.
                const shipOpen = !!f || openShips.has(g.shipTypeId)
                return (
                  <ShipGroupRows
                    key={g.shipTypeId}
                    shipTypeId={g.shipTypeId}
                    fits={g.fits}
                    open={shipOpen}
                    onToggle={() => toggleShip(g.shipTypeId)}
                    openFit={openFit}
                    onToggleFit={(fid) => setOpenFit(openFit === fid ? null : fid)}
                    onDeleted={onDeleted}
                    lang={lang}
                  />
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}

function ShipGroupRows({
  shipTypeId,
  fits,
  open,
  onToggle,
  openFit,
  onToggleFit,
  onDeleted,
  lang
}: {
  shipTypeId: number
  fits: GameFitting[]
  open: boolean
  onToggle: () => void
  openFit: number | null
  onToggleFit: (id: number) => void
  onDeleted: () => void
  lang: 0 | 1
}) {
  const ship = getBasic(shipTypeId)
  return (
    <>
      <tr className="clickable ship-group-row" onClick={onToggle}>
        <td colSpan={3}>
          <span className="with-icon">
            <span className="mt-caret">{open ? '▾' : '▸'}</span>
            <img className="type-icon" src={`https://images.evetech.net/types/${shipTypeId}/icon?size=32`} width={28} height={28} alt="" />
            <b>{tn(ship?.n, lang)}</b>
          </span>
        </td>
        <td className="num muted">{`${fits.length} фит.`}</td>
      </tr>
      {open &&
        fits.map((fit) => <FitRow key={fit.fitting_id} fit={fit} open={openFit === fit.fitting_id} onToggle={() => onToggleFit(fit.fitting_id)} onDeleted={onDeleted} />)}
    </>
  )
}

function FitRow({ fit, open, onToggle, onDeleted }: { fit: GameFitting; open: boolean; onToggle: () => void; onDeleted: () => void }) {
  return (
    <>
      <tr className="clickable fit-in-group" onClick={onToggle}>
        <td colSpan={3}>
          {open ? '▾' : '▸'} <span translate="no">{fit.name}</span>
        </td>
        <td className="num muted">{`${fit.items.length} предм.`}</td>
      </tr>
      {open && (
        <tr className="sub-row">
          <td colSpan={4}>
            {fit.description && <p className="muted small">{fit.description}</p>}
            <GameButton
              scope={SCOPE.writeFits}
              className="ghost small danger"
              confirm={`Удалить фит «${fit.name}» из игры? Это нельзя отменить.`}
              action={async (who) => {
                await deleteGameFit(who, fit.fitting_id)
                onDeleted()
              }}
            >
              Удалить из игры
            </GameButton>
            <FitView shipTypeId={fit.ship_type_id} name={fit.name} items={fit.items.map((i) => ({ typeId: i.type_id, flag: i.flag, qty: i.quantity }))} />
          </td>
        </tr>
      )}
    </>
  )
}
