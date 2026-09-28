import { useState } from 'react'
import { TypeLink } from '../../components/TypeLink'
import { Card, Empty, Loading } from '../../components/ui'
import { esi, resolveLocations, resolveNames } from '../../lib/esi'
import { LocationName } from '../../components/LocationName'
import { GameButton } from '../../components/GameButton'
import { openContractInGame, SCOPE } from '../../lib/gameActions'
import { fmtDate, fmtIsk, fmtNum } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { ScopeHint } from '.'

interface Contract {
  contract_id: number
  type: 'item_exchange' | 'auction' | 'courier' | 'loan' | 'unknown'
  status: string
  title?: string
  price?: number
  reward?: number
  collateral?: number
  volume?: number
  date_issued: string
  date_expired: string
  date_completed?: string
  issuer_id: number
  assignee_id: number
  acceptor_id: number
  start_location_id?: number
  end_location_id?: number
  for_corporation: boolean
}

const TYPE_RU: Record<string, string> = { item_exchange: 'Обмен', auction: 'Аукцион', courier: 'Курьер', loan: 'Заём', unknown: '?' }
const STATUS_RU: Record<string, string> = {
  outstanding: 'Открыт',
  in_progress: 'Выполняется',
  finished_issuer: 'Завершён',
  finished_contractor: 'Завершён',
  finished: 'Завершён',
  cancelled: 'Отменён',
  rejected: 'Отклонён',
  failed: 'Провален',
  deleted: 'Удалён',
  reversed: 'Отменён'
}

export default function Contracts({ id }: { id: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const [onlyActive, setOnlyActive] = useState(false)
  const { data, error, loading } = useAsync(async () => {
    const list = await esi<Contract[]>(`/characters/${id}/contracts/`, { characterId: id, allPages: true })
    const names = await resolveNames(list.flatMap((c) => [c.issuer_id, c.assignee_id, c.acceptor_id]))
    const locations = await resolveLocations(list.flatMap((c) => [c.start_location_id ?? 0, c.end_location_id ?? 0]), id)
    return { list: list.sort((a, b) => b.date_issued.localeCompare(a.date_issued)), names, locations }
  }, [id])

  if (loading) return <Loading />
  if (error || !data) return <ScopeHint scope="esi-contracts.read_character_contracts.v1" />
  const list = data.list.filter((c) => !onlyActive || c.status === 'outstanding' || c.status === 'in_progress')

  return (
    <>
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Только активные
        </label>
      </div>
      <Card>
        {!list.length ? (
          <Empty>Контрактов нет</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>Название</th>
                <th>Статус</th>
                <th>От кого → кому</th>
                <th className="num">Цена / награда</th>
                <th className="num">Выставлен</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <ContractRow key={c.contract_id} c={c} id={id} names={data.names} locations={data.locations} open={open === c.contract_id} onToggle={() => setOpen(open === c.contract_id ? null : c.contract_id)} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}

function ContractRow({ c, id, names, locations, open, onToggle }: { c: Contract; id: number; names: Map<number, string>; locations: Map<number, string>; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>
          {open ? '▾' : '▸'} {TYPE_RU[c.type]}
        </td>
        <td>{c.title || <span className="muted">без названия</span>}</td>
        <td>{STATUS_RU[c.status] ?? c.status}</td>
        <td className="small">
          {names.get(c.issuer_id)} → {c.assignee_id ? names.get(c.assignee_id) ?? 'публичный' : 'публичный'}
        </td>
        <td className="num">{fmtIsk(c.type === 'courier' ? c.reward ?? 0 : c.price ?? 0, true)}</td>
        <td className="num muted small">{fmtDate(c.date_issued)}</td>
      </tr>
      {open && (
        <tr className="sub-row">
          <td colSpan={6}>
            <ContractDetails c={c} id={id} locations={locations} />
          </td>
        </tr>
      )}
    </>
  )
}

function ContractDetails({ c, id, locations }: { c: Contract; id: number; locations: Map<number, string> }) {
  const { data, loading } = useAsync(
    () => esi<{ record_id: number; type_id: number; quantity: number; is_included: boolean }[]>(`/characters/${id}/contracts/${c.contract_id}/items/`, { characterId: id }).catch(() => []),
    [c.contract_id]
  )
  return (
    <div className="contract-details">
      <GameButton scope={SCOPE.openWindow} action={(who) => openContractInGame(who, c.contract_id)} title="Открыть этот контракт в клиенте игры">
        Открыть в игре
      </GameButton>
      <div className="small muted">
        {c.start_location_id ? (
          <>
            <span>Откуда:</span> <LocationName id={c.start_location_id} name={locations.get(c.start_location_id) ?? String(c.start_location_id)} characterId={id} />
          </>
        ) : null}
        {c.end_location_id && c.end_location_id !== c.start_location_id ? (
          <>
            {' · '}
            <span>Куда:</span> <LocationName id={c.end_location_id} name={locations.get(c.end_location_id) ?? String(c.end_location_id)} characterId={id} />
          </>
        ) : null}
        {c.collateral ? ` · Залог: ${fmtIsk(c.collateral, true)}` : ''}
        {c.volume ? ` · Объём: ${fmtNum(c.volume)} м³` : ''}
        {` · Истекает: ${fmtDate(c.date_expired)}`}
      </div>
      {loading ? (
        <Loading />
      ) : data?.length ? (
        <ul className="plain-list">
          {data.map((i) => (
            <li key={i.record_id}>
              <span className={i.is_included ? 'good' : 'bad'}>{i.is_included ? 'отдаёт' : 'просит'}</span> <TypeLink id={i.type_id} /> ×{fmtNum(i.quantity)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted small">Предметов нет (или ESI не отдаёт их для этого контракта).</div>
      )}
    </div>
  )
}
