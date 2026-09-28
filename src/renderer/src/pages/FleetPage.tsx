// Fleet management through ESI: the fleet the character is in, its wings, squads and members,
// and — for the fleet boss — MOTD, free move, invites, kicks, moves and renames.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import { GameButton } from '../components/GameButton'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, RequireLogin, Stat } from '../components/ui'
import { esi, imageUrl, resolveIds, resolveNames } from '../lib/esi'
import { hasScope, SCOPE } from '../lib/gameActions'
import { useTypeBasics } from '../lib/sde'
import { useAsync, useTick } from '../lib/useAsync'
import type { CharacterAuth } from '../../../shared/types'

interface MyFleet {
  fleet_id: number
  role: string
  wing_id: number
  squad_id: number
}
interface FleetInfo {
  motd: string
  is_free_move: boolean
  is_voice_enabled: boolean
  is_registered: boolean
}
interface Member {
  character_id: number
  ship_type_id: number
  solar_system_id: number
  role: 'fleet_commander' | 'wing_commander' | 'squad_commander' | 'squad_member'
  wing_id: number
  squad_id: number
  join_time: string
  takes_fleet_warp: boolean
}
interface Wing {
  id: number
  name: string
  squads: { id: number; name: string }[]
}

const ROLE_LABEL: Record<Member['role'], string> = {
  fleet_commander: 'Командир флота',
  wing_commander: 'Командир крыла',
  squad_commander: 'Командир сквада',
  squad_member: 'Пилот'
}

export default function FleetPage() {
  const { active } = useApp()
  if (!active) return <RequireLogin what="флот" />
  if (!hasScope(active, SCOPE.readFleet))
    return (
      <div className="page">
        <Empty>Чтобы видеть и вести флот, нажмите «Настройки → Разрешить действия в игре» и войдите заново.</Empty>
      </div>
    )
  return <Fleet who={active} />
}

function Fleet({ who }: { who: CharacterAuth }) {
  const tick = useTick(30_000)
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)

  const data = useAsync(async () => {
    const opts = { characterId: who.id, fresh: true }
    const mine = await esi<MyFleet>(`/characters/${who.id}/fleet/`, opts).catch((e: Error) => {
      if (/404/.test(e.message)) return null
      throw e
    })
    if (!mine) return { mine: null }
    // Fleet details, members and wings are only given to the fleet boss.
    const [info, members, wings] = await Promise.all([
      esi<FleetInfo>(`/fleets/${mine.fleet_id}/`, opts).catch(() => null),
      esi<Member[]>(`/fleets/${mine.fleet_id}/members/`, opts).catch(() => null),
      esi<Wing[]>(`/fleets/${mine.fleet_id}/wings/`, opts).catch(() => null)
    ])
    const ids = [...new Set([...(members ?? []).flatMap((m) => [m.character_id, m.solar_system_id])])]
    const names = ids.length ? await resolveNames(ids).catch(() => new Map<number, string>()) : new Map<number, string>()
    return { mine, info, members, wings, names }
  }, [who.id, version, tick])
  useTypeBasics(data.data?.members?.map((m) => m.ship_type_id) ?? [])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} />
  const d = data.data
  if (!d?.mine)
    return (
      <div className="page">
        <Empty>Персонаж сейчас не во флоте. Создайте флот в игре — здесь появятся его состав и управление.</Empty>
      </div>
    )
  const { mine, info, members, wings, names } = d
  const fleetId = mine.fleet_id
  const isBoss = !!members
  const canWrite = hasScope(who, SCOPE.writeFleet)
  const nameOf = (id: number) => names?.get(id) ?? String(id)

  return (
    <div className="page">
      <div className="stats-row">
        <Stat label="Ваша роль" value={ROLE_LABEL[mine.role as Member['role']] ?? mine.role} />
        <Stat label="Пилотов" value={members?.length ?? '—'} sub={isBoss ? undefined : 'состав виден только командиру флота'} />
        {info && <Stat label="Свободное перемещение" value={info.is_free_move ? 'включено' : 'выключено'} />}
      </div>
      {!isBoss ? (
        <Empty>ESI отдаёт состав и управление флотом только его командиру (boss). Попросите передать вам командование — и всё появится здесь.</Empty>
      ) : (
        <>
          {info && <FleetSettings fleetId={fleetId} who={who} info={info} canWrite={canWrite} onChanged={reload} />}
          <Invite fleetId={fleetId} who={who} wings={wings ?? []} canWrite={canWrite} onChanged={reload} />
          <Composition members={members!} />
          {(wings ?? []).map((w) => (
            <Card
              key={w.id}
              title={
                <Rename
                  name={w.name}
                  canWrite={canWrite}
                  onRename={(name) => esi(`/fleets/${fleetId}/wings/${w.id}/`, { method: 'PUT', characterId: who.id, body: { name } }).then(reload)}
                />
              }
              actions={
                canWrite && (
                  <>
                    <GameButton scope={SCOPE.writeFleet} className="ghost small" action={() => esi(`/fleets/${fleetId}/wings/${w.id}/squads/`, { method: 'POST', characterId: who.id }).then(reload)}>
                      + сквад
                    </GameButton>
                    <GameButton
                      scope={SCOPE.writeFleet}
                      className="ghost small danger"
                      confirm={`Удалить крыло «${w.name}»? (только пустое)`}
                      action={() => esi(`/fleets/${fleetId}/wings/${w.id}/`, { method: 'DELETE', characterId: who.id }).then(reload)}
                    >
                      удалить крыло
                    </GameButton>
                  </>
                )
              }
            >
              <MembersTable members={members!.filter((m) => m.wing_id === w.id && m.role === 'wing_commander')} nameOf={nameOf} fleetId={fleetId} who={who} wings={wings!} canWrite={canWrite} onChanged={reload} />
              {w.squads.map((sq) => (
                <div key={sq.id} className="fleet-squad">
                  <div className="fleet-squad-head">
                    <Rename
                      name={sq.name}
                      canWrite={canWrite}
                      onRename={(name) => esi(`/fleets/${fleetId}/squads/${sq.id}/`, { method: 'PUT', characterId: who.id, body: { name } }).then(reload)}
                    />
                    {canWrite && (
                      <GameButton
                        scope={SCOPE.writeFleet}
                        className="ghost small danger"
                        confirm={`Удалить сквад «${sq.name}»? (только пустой)`}
                        action={() => esi(`/fleets/${fleetId}/squads/${sq.id}/`, { method: 'DELETE', characterId: who.id }).then(reload)}
                      >
                        ✕
                      </GameButton>
                    )}
                  </div>
                  <MembersTable members={members!.filter((m) => m.squad_id === sq.id)} nameOf={nameOf} fleetId={fleetId} who={who} wings={wings!} canWrite={canWrite} onChanged={reload} />
                </div>
              ))}
            </Card>
          ))}
          {canWrite && (
            <GameButton scope={SCOPE.writeFleet} action={() => esi(`/fleets/${fleetId}/wings/`, { method: 'POST', characterId: who.id }).then(reload)}>
              + крыло
            </GameButton>
          )}
          {members!.some((m) => m.role === 'fleet_commander') && (
            <Card title="Командир флота">
              <MembersTable members={members!.filter((m) => m.role === 'fleet_commander')} nameOf={nameOf} fleetId={fleetId} who={who} wings={wings ?? []} canWrite={canWrite} onChanged={reload} />
            </Card>
          )}
        </>
      )}
      <p className="muted small">Обновляется каждые 30 секунд. Все изменения — по вашим кнопкам, через официальный ESI.</p>
    </div>
  )
}

function Rename({ name, canWrite, onRename }: { name: string; canWrite: boolean; onRename: (name: string) => Promise<unknown> }) {
  const [edit, setEdit] = useState<string | null>(null)
  if (edit === null)
    return (
      <span className="fleet-name" translate="no">
        {name}
        {canWrite && (
          <button className="ghost small" title="Переименовать" onClick={() => setEdit(name)}>
            ✎
          </button>
        )}
      </span>
    )
  return (
    <span className="row">
      <input value={edit} maxLength={10} onChange={(e) => setEdit(e.target.value)} />
      <button className="small" onClick={() => void onRename(edit.trim()).then(() => setEdit(null))}>
        OK
      </button>
      <button className="ghost small" onClick={() => setEdit(null)}>
        ✕
      </button>
    </span>
  )
}

function FleetSettings({ fleetId, who, info, canWrite, onChanged }: { fleetId: number; who: CharacterAuth; info: FleetInfo; canWrite: boolean; onChanged: () => void }) {
  const [motd, setMotd] = useState(info.motd)
  useEffect(() => setMotd(info.motd), [info.motd])
  const put = (body: Partial<FleetInfo>) => esi(`/fleets/${fleetId}/`, { method: 'PUT', characterId: who.id, body }).then(onChanged)
  return (
    <Card title="Настройки флота">
      <label>
        MOTD
        <textarea rows={3} value={motd} disabled={!canWrite} onChange={(e) => setMotd(e.target.value)} />
      </label>
      <div className="row">
        <GameButton scope={SCOPE.writeFleet} className="" action={() => put({ motd })} done="сохранено">
          Сохранить MOTD
        </GameButton>
        <GameButton scope={SCOPE.writeFleet} action={() => put({ is_free_move: !info.is_free_move })}>
          {info.is_free_move ? 'Выключить свободное перемещение' : 'Включить свободное перемещение'}
        </GameButton>
      </div>
    </Card>
  )
}

function Invite({ fleetId, who, wings, canWrite, onChanged }: { fleetId: number; who: CharacterAuth; wings: Wing[]; canWrite: boolean; onChanged: () => void }) {
  const [names, setNames] = useState('')
  const [squad, setSquad] = useState('')
  const [result, setResult] = useState<string | null>(null)
  if (!canWrite) return null
  const target = squad ? (() => {
    const [w, s] = squad.split(':').map(Number)
    return { role: 'squad_member', wing_id: w, squad_id: s }
  })() : { role: 'squad_member' }
  return (
    <Card title="Пригласить во флот">
      <textarea rows={3} value={names} placeholder="Имена пилотов — через запятую или по одному в строке (можно вставить список из локала)" onChange={(e) => setNames(e.target.value)} />
      <div className="row">
        <select value={squad} onChange={(e) => setSquad(e.target.value)}>
          <option value="">В любой свободный сквад</option>
          {wings.flatMap((w) =>
            w.squads.map((s) => (
              <option key={s.id} value={`${w.id}:${s.id}`}>
                {`${w.name} / ${s.name}`}
              </option>
            ))
          )}
        </select>
        <GameButton
          scope={SCOPE.writeFleet}
          className=""
          action={async () => {
            const list = names.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
            const r = await resolveIds(list)
            const chars = r.characters ?? []
            let ok = 0
            const failed: string[] = []
            for (const c of chars) {
              try {
                await esi(`/fleets/${fleetId}/members/`, { method: 'POST', characterId: who.id, body: { character_id: c.id, ...target } })
                ok++
              } catch {
                failed.push(c.name)
              }
            }
            const unknown = list.filter((n) => !chars.some((c) => c.name.toLowerCase() === n.toLowerCase()))
            setResult(`Приглашено: ${ok}${failed.length ? ` · не удалось: ${failed.join(', ')}` : ''}${unknown.length ? ` · не найдены: ${unknown.join(', ')}` : ''}`)
            setNames('')
            onChanged()
          }}
        >
          Пригласить
        </GameButton>
      </div>
      {result && <p className="small" translate="no">{result}</p>}
    </Card>
  )
}

function Composition({ members }: { members: Member[] }) {
  const byShip = useMemo(() => {
    const m = new Map<number, number>()
    members.forEach((x) => m.set(x.ship_type_id, (m.get(x.ship_type_id) ?? 0) + 1))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [members])
  return (
    <Card title="Состав по кораблям">
      <div className="link-grid">
        {byShip.map(([id, n]) => (
          <span key={id}>
            <TypeLink id={id} size={20} /> <span className="muted">{`×${n}`}</span>
          </span>
        ))}
      </div>
    </Card>
  )
}

function MembersTable({
  members,
  nameOf,
  fleetId,
  who,
  wings,
  canWrite,
  onChanged
}: {
  members: Member[]
  nameOf: (id: number) => string
  fleetId: number
  who: CharacterAuth
  wings: Wing[]
  canWrite: boolean
  onChanged: () => void
}) {
  if (!members.length) return null
  return (
    <table className="table compact fleet-members">
      <tbody>
        {members.map((m) => (
          <tr key={m.character_id}>
            <td>
              <span className="with-icon">
                <img src={imageUrl.portrait(m.character_id, 32)} width={22} height={22} alt="" className="portrait-sm" />
                <span translate="no">{nameOf(m.character_id)}</span>
              </span>
            </td>
            <td className="muted small">{ROLE_LABEL[m.role]}</td>
            <td>
              <TypeLink id={m.ship_type_id} size={18} />
            </td>
            <td className="muted small" translate="no">
              {nameOf(m.solar_system_id)}
            </td>
            <td className="nowrap">
              {canWrite && m.character_id !== who.id && (
                <>
                  <select
                    value=""
                    title="Переместить"
                    onChange={(e) => {
                      if (!e.target.value) return
                      const [w, s] = e.target.value.split(':').map(Number)
                      void esi(`/fleets/${fleetId}/members/${m.character_id}/`, { method: 'PUT', characterId: who.id, body: { role: 'squad_member', wing_id: w, squad_id: s } }).then(onChanged)
                    }}
                  >
                    <option value="">переместить…</option>
                    {wings.flatMap((w) =>
                      w.squads.map((s) => (
                        <option key={s.id} value={`${w.id}:${s.id}`}>
                          {`${w.name} / ${s.name}`}
                        </option>
                      ))
                    )}
                  </select>
                  <GameButton
                    scope={SCOPE.writeFleet}
                    className="ghost small danger"
                    confirm={`Исключить ${nameOf(m.character_id)} из флота?`}
                    action={() => esi(`/fleets/${fleetId}/members/${m.character_id}/`, { method: 'DELETE', characterId: who.id }).then(onChanged)}
                  >
                    исключить
                  </GameButton>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
