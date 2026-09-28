// Character contacts: list with standings, add by name, change standing, remove.

import { useMemo, useState } from 'react'
import { useApp } from '../../AppContext'
import { GameButton } from '../../components/GameButton'
import { Card, Empty, ErrorBox, Loading } from '../../components/ui'
import { esi, imageUrl, resolveIds, resolveNames } from '../../lib/esi'
import { addContacts, deleteContacts, editContacts, hasScope, SCOPE } from '../../lib/gameActions'
import { useAsync } from '../../lib/useAsync'
import { ScopeHint } from '.'

interface Contact {
  contact_id: number
  contact_type: 'character' | 'corporation' | 'alliance' | 'faction'
  standing: number
  is_watched?: boolean
  label_ids?: number[]
}

export const STANDINGS: [number, string][] = [
  [10, 'Отличная (+10)'],
  [5, 'Хорошая (+5)'],
  [0, 'Нейтральная (0)'],
  [-5, 'Плохая (−5)'],
  [-10, 'Ужасная (−10)']
]

const standingClass = (s: number) => (s >= 5 ? 'st-excellent' : s > 0 ? 'st-good' : s === 0 ? 'st-neutral' : s > -5 ? 'st-bad' : 'st-terrible')

function portrait(c: Contact): string {
  if (c.contact_type === 'character') return imageUrl.portrait(c.contact_id, 32)
  if (c.contact_type === 'corporation') return imageUrl.corpLogo(c.contact_id, 32)
  if (c.contact_type === 'alliance') return imageUrl.allianceLogo(c.contact_id, 32)
  return `https://images.evetech.net/corporations/${c.contact_id}/logo?size=32`
}

export default function Contacts({ id }: { id: number }) {
  const { active } = useApp()
  const [version, setVersion] = useState(0)
  const [name, setName] = useState('')
  const [standing, setStanding] = useState(-10)
  const [addError, setAddError] = useState<string | null>(null)
  const canWrite = hasScope(active, SCOPE.writeContacts)

  const data = useAsync(async () => {
    const list = await esi<Contact[]>(`/characters/${id}/contacts/`, { characterId: id, allPages: true, fresh: version > 0 })
    const names = await resolveNames(list.map((c) => c.contact_id))
    return list.map((c) => ({ ...c, name: names.get(c.contact_id) ?? String(c.contact_id) })).sort((a, b) => b.standing - a.standing || a.name.localeCompare(b.name))
  }, [id, version])
  const reload = () => setVersion((v) => v + 1)

  const groups = useMemo(() => {
    const m = new Map<number, NonNullable<typeof data.data>>()
    for (const c of data.data ?? []) {
      const key = c.standing >= 5 ? 10 : c.standing > 0 ? 5 : c.standing === 0 ? 0 : c.standing > -5 ? -5 : -10
      m.set(key, [...(m.get(key) ?? []), c])
    }
    return STANDINGS.map(([s, label]) => ({ s, label, list: m.get(s) ?? [] })).filter((g) => g.list.length)
  }, [data.data])

  async function add(who: NonNullable<typeof active>) {
    setAddError(null)
    const r = await resolveIds([name.trim()])
    const found = [...(r.characters ?? []), ...(r.corporations ?? []), ...(r.alliances ?? [])][0]
    if (!found) {
      setAddError('Не найден персонаж, корпорация или альянс с таким точным названием')
      throw new Error('не найдено')
    }
    await addContacts(who, [found.id], standing)
    setName('')
    reload()
  }

  if (data.loading) return <Loading />
  if (data.error) return <ScopeHint scope="esi-characters.read_contacts.v1" />
  return (
    <>
      <Card title="Добавить контакт">
        <div className="row">
          <input className="grow" value={name} placeholder="Точное имя персонажа, корпорации или альянса" onChange={(e) => setName(e.target.value)} />
          <select value={standing} onChange={(e) => setStanding(Number(e.target.value))}>
            {STANDINGS.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
          <GameButton scope={SCOPE.writeContacts} action={add} className="" done="добавлен">
            Добавить
          </GameButton>
        </div>
        <ErrorBox error={addError} />
        {!canWrite && <p className="muted small">Чтобы менять контакты из Canopus, нажмите «Настройки → Разрешить действия в игре».</p>}
      </Card>
      {!groups.length ? (
        <Empty>Контактов нет.</Empty>
      ) : (
        groups.map((g) => (
          <Card key={g.s} title={`${g.label}: ${g.list.length}`}>
            <table className="table compact">
              <tbody>
                {g.list.map((c) => (
                  <tr key={c.contact_id}>
                    <td>
                      <span className="with-icon">
                        <img src={portrait(c)} width={24} height={24} alt="" className="portrait-sm" />
                        <span translate="no">{c.name}</span>
                        {c.is_watched && <span className="muted small">· наблюдение</span>}
                      </span>
                    </td>
                    <td className="muted small">{c.contact_type}</td>
                    <td className={`num ${standingClass(c.standing)}`}>{c.standing > 0 ? `+${c.standing}` : c.standing}</td>
                    <td className="nowrap">
                      {canWrite && (
                        <select
                          value=""
                          onChange={async (e) => {
                            if (!active || e.target.value === '') return
                            await editContacts(active, [c.contact_id], Number(e.target.value))
                            reload()
                          }}
                        >
                          <option value="">изменить…</option>
                          {STANDINGS.map(([s, label]) => (
                            <option key={s} value={s}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                      <GameButton
                        scope={SCOPE.writeContacts}
                        className="ghost small danger"
                        confirm={`Удалить ${c.name} из контактов?`}
                        action={async (who) => {
                          await deleteContacts(who, [c.contact_id])
                          reload()
                        }}
                      >
                        ✕
                      </GameButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </>
  )
}
