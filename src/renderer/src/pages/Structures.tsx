// The corporation's structures: state and its timer, fuel left and the services, from ESI
// (esi-corporations.read_structures.v1, the character needs the Station Manager role).

import { useApp } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, RequireLogin, Sec } from '../components/ui'
import { esi, systemInfo } from '../lib/esi'
import { fmtDuration } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const SCOPE = 'esi-corporations.read_structures.v1'

interface CorpStructure {
  structure_id: number
  name?: string
  type_id: number
  system_id: number
  state: string
  state_timer_end?: string
  fuel_expires?: string
  services?: { name: string; state: 'online' | 'offline' | 'cleanup' }[]
}

const STATE: Record<string, [string, 'good' | 'warn-text' | 'bad' | 'muted']> = {
  shield_vulnerable: ['В строю', 'good'],
  armor_vulnerable: ['Броня уязвима', 'warn-text'],
  hull_vulnerable: ['Корпус уязвим', 'bad'],
  armor_reinforce: ['Реинфорс (броня)', 'bad'],
  hull_reinforce: ['Реинфорс (корпус)', 'bad'],
  anchoring: ['Установка', 'muted'],
  onlining_vulnerable: ['Включение', 'muted'],
  deploy_vulnerable: ['Развёртывание', 'muted'],
  fitting_invulnerable: ['Неуязвима', 'muted'],
  online_deprecated: ['В строю', 'good'],
  unanchored: ['Снята с якоря', 'muted'],
  unknown: ['Неизвестно', 'muted']
}

export default function Structures() {
  const { active } = useApp()
  const data = useAsync(async () => {
    if (!active || !active.scopes.includes(SCOPE)) return null
    const me = await esi<{ corporation_id: number }>(`/characters/${active.id}/`)
    const list = await esi<CorpStructure[]>(`/corporations/${me.corporation_id}/structures/`, { characterId: active.id })
    const systems = new Map(await Promise.all([...new Set(list.map((s) => s.system_id))].map(async (id) => [id, await systemInfo(id)] as const)))
    // Fuel running out first on top.
    list.sort((a, b) => (a.fuel_expires ? Date.parse(a.fuel_expires) : Infinity) - (b.fuel_expires ? Date.parse(b.fuel_expires) : Infinity))
    return { list, systems }
  }, [active?.id, active?.scopes.join(' ')])

  if (!active) return <RequireLogin what="структуры корпорации" />
  if (!active.scopes.includes(SCOPE)) return <Empty>Нажмите «Настройки → Разрешить структуры корпорации». В игре у персонажа должна быть роль Station Manager.</Empty>
  if (data.loading && !data.data) return <Loading />
  if (data.error)
    return <ErrorBox error={/403/.test(data.error) ? 'ESI отказал: у персонажа нет роли Station Manager в корпорации.' : data.error} />
  const list = data.data?.list ?? []
  if (!list.length) return <Empty>У корпорации нет структур.</Empty>
  const now = Date.now()
  return (
    <Card
      title={`Структуры корпорации: ${list.length}`}
      actions={
        <button className="ghost" onClick={data.reload}>
          Обновить
        </button>
      }
    >
      <div className="all-chars">
        <table className="table">
          <thead>
            <tr>
              <th>Структура</th>
              <th>Система</th>
              <th>Состояние</th>
              <th>Топливо</th>
              <th>Сервисы</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const sys = data.data!.systems.get(s.system_id)
              const [label, cls] = STATE[s.state] ?? [s.state, 'muted']
              const fuel = s.fuel_expires ? Date.parse(s.fuel_expires) - now : null
              const timer = s.state_timer_end ? Date.parse(s.state_timer_end) - now : null
              return (
                <tr key={s.structure_id}>
                  <td>
                    <div translate="no">{s.name ?? `#${s.structure_id}`}</div>
                    <TypeLink id={s.type_id} />
                  </td>
                  <td>
                    {sys ? (
                      <>
                        <Sec value={sys.security_status} /> <span translate="no">{sys.name}</span>
                      </>
                    ) : (
                      s.system_id
                    )}
                  </td>
                  <td>
                    <span className={cls}>{label}</span>
                    {timer !== null && timer > 0 && <div className="muted small">{`таймер через ${fmtDuration(timer)}`}</div>}
                  </td>
                  <td>
                    {fuel === null ? (
                      <span className="muted">без топлива</span>
                    ) : (
                      <span className={fuel < 3 * 86400_000 ? 'bad' : fuel < 7 * 86400_000 ? 'warn-text' : ''}>{fmtDuration(Math.max(0, fuel))}</span>
                    )}
                  </td>
                  <td className="small">
                    {(s.services ?? []).map((sv) => (
                      <div key={sv.name} className={sv.state === 'online' ? '' : 'bad'}>
                        {sv.name}
                        {sv.state !== 'online' && ` (${sv.state})`}
                      </div>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Уведомления о топливе и реинфорсе — в «Настройках → Трей и уведомления».</p>
    </Card>
  )
}
