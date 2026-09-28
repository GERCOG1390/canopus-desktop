// EVE calendar: upcoming events, details and the response (accept / maybe / decline).

import { useState } from 'react'
import { useApp } from '../../AppContext'
import { GameButton } from '../../components/GameButton'
import { Card, Empty, ErrorBox, Loading } from '../../components/ui'
import { esi } from '../../lib/esi'
import { fmtDate } from '../../lib/format'
import { hasScope, SCOPE } from '../../lib/gameActions'
import { useAsync } from '../../lib/useAsync'

interface EventSummary {
  event_id: number
  event_date: string
  title: string
  importance?: number
  event_response?: 'declined' | 'not_responded' | 'accepted' | 'tentative'
}
interface EventDetails {
  date: string
  duration: number
  owner_name: string
  owner_type: string
  response: string
  text: string
  title: string
}

const RESPONSE_LABEL: Record<string, string> = { accepted: 'Приду', tentative: 'Возможно', declined: 'Не приду', not_responded: 'Нет ответа' }

export default function Calendar({ id }: { id: number }) {
  const { active } = useApp()
  const [version, setVersion] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const events = useAsync(() => esi<EventSummary[]>(`/characters/${id}/calendar/`, { characterId: id, fresh: version > 0 }), [id, version])
  if (!hasScope(active, SCOPE.readCalendar)) return <Empty>Чтобы видеть календарь, нажмите «Настройки → Разрешить действия в игре» и войдите заново.</Empty>
  if (events.loading) return <Loading />
  if (events.error) return <ErrorBox error={events.error} />
  if (!events.data?.length) return <Empty>Ближайших событий нет.</Empty>
  return (
    <Card>
      <table className="table compact">
        <tbody>
          {events.data.map((e) => (
            <EventRow key={e.event_id} id={id} e={e} open={open === e.event_id} onToggle={() => setOpen(open === e.event_id ? null : e.event_id)} onChanged={() => setVersion((v) => v + 1)} />
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function EventRow({ id, e, open, onToggle, onChanged }: { id: number; e: EventSummary; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const details = useAsync(() => (open ? esi<EventDetails>(`/characters/${id}/calendar/${e.event_id}/`, { characterId: id }) : Promise.resolve(null)), [open, e.event_id])
  const respond = (response: 'accepted' | 'tentative' | 'declined') =>
    esi(`/characters/${id}/calendar/${e.event_id}/`, { method: 'PUT', characterId: id, body: { response } }).then(onChanged)
  return (
    <>
      <tr className={`clickable ${e.importance ? 'important' : ''}`} onClick={onToggle}>
        <td className="nowrap">{fmtDate(e.event_date)}</td>
        <td translate="no">
          {e.importance ? '❗ ' : ''}
          {e.title}
        </td>
        <td className={`small ${e.event_response === 'accepted' ? 'good' : e.event_response === 'declined' ? 'bad' : 'muted'}`}>{RESPONSE_LABEL[e.event_response ?? 'not_responded']}</td>
      </tr>
      {open && (
        <tr className="sub-row">
          <td colSpan={3}>
            {details.loading ? (
              <Loading />
            ) : details.data ? (
              <>
                <div className="muted small" translate="no">{`${details.data.owner_name} · ${details.data.duration} мин`}</div>
                <div className="mail-body" translate="no">
                  {details.data.text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')}
                </div>
              </>
            ) : null}
            <div className="row">
              <GameButton scope={SCOPE.respondCalendar} className="" action={() => respond('accepted')}>
                Приду
              </GameButton>
              <GameButton scope={SCOPE.respondCalendar} action={() => respond('tentative')}>
                Возможно
              </GameButton>
              <GameButton scope={SCOPE.respondCalendar} className="ghost danger" action={() => respond('declined')}>
                Не приду
              </GameButton>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
