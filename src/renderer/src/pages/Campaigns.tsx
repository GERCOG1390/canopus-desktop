// Military Campaigns (Cradle of War): every faction campaign with its live progress from ESI and
// its texts and rewards from the SDE, the objectives with their state, participants and rewards,
// and how much the active character has contributed (esi.activity.char:read).

import { useState } from 'react'
import { useApp } from '../AppContext'
import { Card, Empty, ErrorBox, Loading, ProgressBar } from '../components/ui'
import { esiNew } from '../lib/esi'
import { fmtDate, fmtIsk, fmtNum } from '../lib/format'
import { tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'

const SCOPE = 'esi.activity.char:read'

interface Campaign {
  id: string
  state: string
  progress: number
  started: string
  finished?: string
}

interface Objective {
  id: string
  state: string
  progress: number
  participants?: { total: number; committed: number; contributors: number }
  started: string
  finished?: string
}

/** Contribution of the character to one objective; the field names follow the ESI docs loosely. */
interface MyObjective {
  id?: string
  objective_id?: string
  committed?: boolean
  contribution?: number
  progress?: number
}

/** Cursor-paginated lists of the newer ESI routes: follow "after" until a page comes back empty. */
async function allPages<T>(path: string, key: string, characterId?: number): Promise<T[]> {
  const out: T[] = []
  let after: string | undefined
  for (let page = 0; page < 30; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const r = await esiNew<Record<string, unknown> & { cursor?: { after?: string } }>(after ? `${path}${sep}after=${encodeURIComponent(after)}` : path, characterId ? { characterId } : {})
    const items = (r[key] as T[] | undefined) ?? []
    out.push(...items)
    after = r.cursor?.after
    if (!items.length || !after) break
  }
  return out
}

const STATE: Record<string, [string, string]> = {
  Active: ['Идёт', 'good'],
  Completed: ['Завершена', 'muted'],
  Expired: ['Истекла', 'muted'],
  Failed: ['Провалена', 'bad']
}
const stateLabel = (s: string) => {
  const [label, cls] = STATE[s] ?? [s, 'muted']
  return <span className={cls}>{label}</span>
}

const METHOD: Record<string, string> = {
  CompleteAgentMission: 'Миссии агентов',
  CaptureDefendFWComplex: 'Комплексы ФВ',
  KillNPC: 'Убийство NPC',
  DamageShip: 'Урон по кораблям',
  KillCapsuleer: 'Убийство капсулёров',
  HackSomething: 'Взлом',
  RemoteRepairArmorOrShield: 'Удалённый ремонт',
  Manufacture: 'Производство',
  MineOre: 'Добыча руды'
}

export default function Campaigns() {
  const { lang, sde, active } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const defs = useAsync(() => window.api.sde.campaigns(), [sde.state])
  const list = useAsync(async () => {
    const r = await esiNew<{ campaigns: Campaign[] }>('/military-campaigns')
    // Running campaigns first, then the most recent.
    return r.campaigns.sort((a, b) => Number(b.state === 'Active') - Number(a.state === 'Active') || Date.parse(b.started) - Date.parse(a.started))
  }, [])
  const mine = useAsync(async () => {
    if (!active?.scopes.includes(SCOPE)) return null
    const rows = await allPages<MyObjective>(`/characters/${active.id}/military-campaigns/objectives`, 'objectives', active.id)
    return new Map(rows.map((o) => [o.objective_id ?? o.id ?? '', o]))
  }, [active?.id, active?.scopes.join(' ')])

  if (list.loading && !list.data) return <Loading />
  if (list.error) return <ErrorBox error={list.error} />
  const campaigns = list.data ?? []
  if (!campaigns.length) return <Empty>Сейчас нет военных кампаний.</Empty>
  const d = defs.data

  return (
    <>
      {active && !active.scopes.includes(SCOPE) && <p className="muted small">Чтобы видеть свой вклад, войдите персонажем заново в «Настройках» — нужен новый доступ к активностям.</p>}
      {campaigns.map((c) => {
        const def = d?.campaigns[c.id]
        const target = def?.target || 1
        return (
          <Card
            key={c.id}
            title={def ? tn(def.t, lang) : c.id}
            actions={
              <button className="ghost small" onClick={() => setOpen(open === c.id ? null : c.id)}>
                {open === c.id ? 'Скрыть цели' : 'Цели'}
              </button>
            }
          >
            <div className="row small">
              {stateLabel(c.state)}
              {def?.faction && d?.factions[def.faction] && <span className="muted">{tn(d.factions[def.faction], lang)}</span>}
              <span className="muted">{`${fmtDate(c.started)} — ${c.finished ? fmtDate(c.finished) : '…'}`}</span>
            </div>
            {def && <p className="muted small">{tn(def.s, lang)}</p>}
            <div className="row">
              <div className="grow">
                <ProgressBar value={c.progress / target} />
              </div>
              <span className="small">{`${c.progress} / ${target}`}</span>
            </div>
            {open === c.id && <Objectives campaign={c.id} defs={d?.objectives ?? {}} mine={mine.data ?? null} lang={lang} />}
          </Card>
        )
      })}
      <p className="muted small">Прогресс — ESI, тексты и награды — SDE. Награды указаны за единицу прогресса цели.</p>
    </>
  )
}

function Objectives({
  campaign,
  defs,
  mine,
  lang
}: {
  campaign: string
  defs: Awaited<ReturnType<typeof window.api.sde.campaigns>>['objectives']
  mine: Map<string, MyObjective> | null
  lang: 0 | 1
}) {
  const list = useAsync(() => allPages<Objective>(`/military-campaigns/${campaign}/objectives`, 'objectives'), [campaign])
  if (list.loading && !list.data) return <Loading />
  if (list.error) return <ErrorBox error={list.error} />
  const rows = (list.data ?? []).sort((a, b) => Number(b.state === 'Active') - Number(a.state === 'Active'))
  if (!rows.length) return <Empty>Целей нет.</Empty>
  return (
    <table className="table campaign-objectives">
      <thead>
        <tr>
          <th>Цель</th>
          <th>Состояние</th>
          <th>Прогресс</th>
          <th className="num">Участники</th>
          <th>Награда</th>
          {mine && <th className="num">Мой вклад</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => {
          const def = defs[o.id]
          const target = def?.target || 0
          const my = mine?.get(o.id)
          return (
            <tr key={o.id}>
              <td>
                <div>{def ? tn(def.t, lang) : o.id}</div>
                {def && <div className="muted small">{tn(def.s, lang)}</div>}
                {def?.method && <div className="muted small">{METHOD[def.method] ?? def.method}</div>}
              </td>
              <td>{stateLabel(o.state)}</td>
              <td className="campaign-progress">
                {target ? (
                  <>
                    <ProgressBar value={o.progress / target} />
                    <span className="small">{`${fmtNum(o.progress)} / ${fmtNum(target)}`}</span>
                  </>
                ) : (
                  fmtNum(o.progress)
                )}
              </td>
              <td className="num small">{o.participants ? `${fmtNum(o.participants.contributors)} / ${fmtNum(o.participants.total)}` : '—'}</td>
              <td className="small">
                {def?.isk ? <div>{fmtIsk(def.isk, true)}</div> : null}
                {def?.lp ? <div>{`${fmtNum(def.lp)} LP`}</div> : null}
                {def?.standing ? <div className="muted">{`+${def.standing}% стендинга`}</div> : null}
                {def?.max ? <div className="muted">{`до ${fmtNum(def.max)} на пилота`}</div> : null}
              </td>
              {mine && <td className="num">{my ? (my.contribution ?? my.progress ?? (my.committed ? '✔' : '—')) : <span className="muted">—</span>}</td>}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
