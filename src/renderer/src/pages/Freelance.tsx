// Freelance Jobs board: every public job with details, filters the game doesn't have (any number of
// excluded corporations, minimum reward per unit, distance in jumps from you), the character's own
// jobs with their participation, the corporation's projects, and alerts for new matching jobs.

import { useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import { useIntel } from '../IntelContext'
import { Card, Empty, ErrorBox, Loading, ProgressBar } from '../components/ui'
import { DEFAULT_FREELANCE, matchesFreelance, type FreelanceFilter, type FreelanceJob } from '../../../shared/freelance'
import { esi, esiNew } from '../lib/esi'
import { fmtDuration, fmtIsk, fmtNum } from '../lib/format'
import { tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'

const JOBS_SCOPE = 'esi-characters.read_freelance_jobs.v1'
const PROJECTS_SCOPE = 'esi-corporations.read_projects.v1'

const CAREER: Record<string, string> = {
  Industrialist: 'Промышленник',
  Enforcer: 'Силовик',
  Explorer: 'Исследователь',
  'Soldier of Fortune': 'Солдат удачи',
  Patrol: 'Патруль'
}

interface Listed {
  id: string
  name: string
  state: string
  progress?: { current: number; desired: number }
  reward?: { initial: number; remaining: number }
}

/** Share of a job or project done; ESI sometimes leaves progress out. */
const done = (p?: { current: number; desired: number }) => (p?.desired ? p.current / p.desired : 0)
const amount = (p?: { current: number; desired: number }) => (p ? `${fmtNum(p.current)} / ${fmtNum(p.desired)}` : '—')

async function pages<T>(path: string, key: string, characterId?: number): Promise<T[]> {
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

export default function Freelance() {
  const { settings, updateSettings, active, lang, sde } = useApp()
  const intel = useIntel()
  // Again once the SDE is ready (it may still be building when the tab opens).
  const types = useAsync(() => window.api.sde.jobTypes(), [sde.state])
  const f = settings?.freelance ?? DEFAULT_FREELANCE
  const set = (patch: Partial<FreelanceFilter>) => updateSettings({ freelance: { ...f, ...patch } })
  const [exclude, setExclude] = useState(f.excludeCorps.join(', '))

  const jobs = useAsync(async () => {
    const list = await pages<Listed>('/freelance-jobs', 'freelance_jobs')
    return Promise.all(list.map((j) => esiNew<FreelanceJob>(`/freelance-jobs/${j.id}`).catch(() => j as FreelanceJob)))
  }, [])

  // Where you are: the Local log, or ESI location of the active character.
  const location = useAsync(async () => (active ? (await esi<{ solar_system_id: number }>(`/characters/${active.id}/location/`, { characterId: active.id }).catch(() => null))?.solar_system_id ?? null : null), [active?.id])
  const here = intel.system?.id ?? location.data ?? null
  const places = useMemo(() => [...new Set((jobs.data ?? []).flatMap((j) => j.access_and_visibility?.broadcast_locations?.map((p) => p.id) ?? []))], [jobs.data])
  const jumps = useAsync(async (): Promise<Record<number, number>> => (here && places.length ? window.api.intel.jumpsFrom(here, places) : {}), [here, places.join(',')])
  const nearest = (j: FreelanceJob) => {
    const d = jumps.data ?? {}
    return (j.access_and_visibility?.broadcast_locations ?? []).filter((p) => d[p.id] !== undefined).sort((a, b) => d[a.id] - d[b.id])[0]
  }

  const all = (jobs.data ?? []).filter((j) => j.state === 'Active')
  const careers = [...new Set(all.map((j) => j.details?.career).filter(Boolean) as string[])]
  const methods = [...new Set(all.map((j) => j.configuration?.method).filter(Boolean) as string[])]
  const shown = all
    .filter((j) => matchesFreelance(j, f))
    .filter((j) => !f.maxJumps || (nearest(j) && (jumps.data ?? {})[nearest(j)!.id] <= f.maxJumps))
    .sort((a, b) => (b.contribution?.reward_per_contribution ?? 0) - (a.contribution?.reward_per_contribution ?? 0))
  const typeName = (m?: string) => (m ? (types.data?.[m] ? tn(types.data[m].t, lang) : m) : '—')
  const now = Date.now()

  return (
    <>
      {active?.scopes.includes(JOBS_SCOPE) && <MyJobs id={active.id} />}
      <Card
        title={`Фриланс: ${shown.length} из ${all.length}`}
        actions={
          <button className="ghost" disabled={jobs.loading} onClick={jobs.reload}>
            Обновить
          </button>
        }
      >
        <div className="row freelance-filters">
          <input placeholder="Поиск: название, описание, корпорация…" value={f.text} onChange={(e) => set({ text: e.target.value })} />
          <select value={f.careers[0] ?? ''} onChange={(e) => set({ careers: e.target.value ? [e.target.value] : [] })}>
            <option value="">Все карьеры</option>
            {careers.map((c) => (
              <option key={c} value={c}>
                {CAREER[c] ?? c}
              </option>
            ))}
          </select>
          <select value={f.methods[0] ?? ''} onChange={(e) => set({ methods: e.target.value ? [e.target.value] : [] })}>
            <option value="">Все виды работ</option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {typeName(m)}
              </option>
            ))}
          </select>
          <label>
            ISK за единицу от
            <input className="freelance-num" value={f.minReward || ''} onChange={(e) => set({ minReward: Number(e.target.value.replace(/\D/g, '')) || 0 })} placeholder="0" />
          </label>
          <label>
            Рядом
            <select value={f.maxJumps} onChange={(e) => set({ maxJumps: Number(e.target.value) })} disabled={!here} title={here ? undefined : 'Текущая система неизвестна'}>
              <option value={0}>везде</option>
              {[5, 10, 20, 40].map((n) => (
                <option key={n} value={n}>{`до ${n} прыжков`}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="grow">
          Скрыть корпорации (через запятую, без ограничения)
          <input value={exclude} onChange={(e) => setExclude(e.target.value)} onBlur={() => set({ excludeCorps: exclude.split(',').map((c) => c.trim()).filter(Boolean) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={f.notify} onChange={(e) => set({ notify: e.target.checked })} />
          Уведомлять о новых работах под этот фильтр (и в Discord, если задан вебхук разведки)
        </label>

        {jobs.loading && !jobs.data ? (
          <Loading />
        ) : jobs.error ? (
          <ErrorBox error={jobs.error} />
        ) : !shown.length ? (
          <Empty>Под фильтр ничего не подходит.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Работа</th>
                <th>Вид</th>
                <th>Прогресс</th>
                <th className="num">За единицу</th>
                <th className="num">Осталось в фонде</th>
                <th>Где</th>
                <th>Истекает</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => {
                const corp = j.details?.creator?.corporation?.name
                const near = nearest(j)
                const exp = j.details?.expires ? Date.parse(j.details.expires) - now : null
                return (
                  <tr key={j.id}>
                    <td>
                      <div translate="no">{j.name}</div>
                      <div className="muted small">
                        <span translate="no">{corp}</span>
                        {corp && (
                          <button className="gx-link freelance-hide" title="Скрыть работы этой корпорации" onClick={() => (setExclude([...f.excludeCorps, corp].join(', ')), set({ excludeCorps: [...f.excludeCorps, corp] }))}>
                            скрыть
                          </button>
                        )}
                      </div>
                      {j.details?.career && <div className="muted small">{CAREER[j.details.career] ?? j.details.career}</div>}
                    </td>
                    <td className="small">{typeName(j.configuration?.method)}</td>
                    <td className="campaign-progress">
                      <ProgressBar value={done(j.progress)} />
                      <span className="small">{amount(j.progress)}</span>
                    </td>
                    <td className="num">{j.contribution?.reward_per_contribution ? fmtIsk(j.contribution.reward_per_contribution, true) : '—'}</td>
                    <td className="num">{j.reward ? fmtIsk(j.reward.remaining, true) : '—'}</td>
                    <td className="small">
                      {near ? (
                        <>
                          <span translate="no">{near.name}</span>
                          <span className="muted">{` · ${(jumps.data ?? {})[near.id]} прыж.`}</span>
                        </>
                      ) : (
                        <span className="muted" translate="no">
                          {j.access_and_visibility?.broadcast_locations?.[0]?.name ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="small">{exp === null ? '—' : exp > 0 ? fmtDuration(exp) : <span className="muted">истекла</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">Только публичные работы — без списка доступа. Работы для своих видны в игре и в «Моих работах».</p>
      </Card>
      {active?.scopes.includes(PROJECTS_SCOPE) && <CorpProjects id={active.id} />}
    </>
  )
}

function MyJobs({ id }: { id: number }) {
  const data = useAsync(async () => {
    const list = await pages<Listed>(`/characters/${id}/freelance-jobs`, 'freelance_jobs', id)
    return Promise.all(
      list.map(async (j) => ({ ...j, part: await esiNew<{ contributed: number; state: string }>(`/characters/${id}/freelance-jobs/${j.id}/participation`, { characterId: id }).catch(() => null) }))
    )
  }, [id])
  if (data.loading && !data.data) return null
  const rows = (data.data ?? []).filter((j) => j.state === 'Active' || j.part?.contributed)
  if (!rows.length) return null
  return (
    <Card title="Мои работы">
      <table className="table">
        <tbody>
          {rows.map((j) => (
            <tr key={j.id}>
              <td translate="no">{j.name}</td>
              <td className="campaign-progress">
                <ProgressBar value={done(j.progress)} />
              </td>
              <td className="num">{j.part ? `${fmtNum(j.part.contributed)} вклад` : '—'}</td>
              <td className="small muted">{j.state === 'Active' ? '' : j.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function CorpProjects({ id }: { id: number }) {
  const data = useAsync(async () => {
    const me = await esi<{ corporation_id: number }>(`/characters/${id}/`)
    const list = await pages<Listed>(`/corporations/${me.corporation_id}/projects?state=Active`, 'projects', id)
    return Promise.all(
      list.map(async (p) => ({
        ...p,
        mine: (await esiNew<{ contributed: number }>(`/corporations/${me.corporation_id}/projects/${p.id}/contribution/${id}`, { characterId: id }).catch(() => null))?.contributed ?? 0
      }))
    )
  }, [id])
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} />
  const rows = data.data ?? []
  return (
    <Card title="Проекты корпорации">
      {!rows.length ? (
        <Empty>Активных проектов нет.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Проект</th>
              <th>Прогресс</th>
              <th className="num">Фонд</th>
              <th className="num">Мой вклад</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td translate="no">{p.name}</td>
                <td className="campaign-progress">
                  <ProgressBar value={done(p.progress)} />
                  <span className="small">{amount(p.progress)}</span>
                </td>
                <td className="num">{p.reward ? fmtIsk(p.reward.remaining, true) : '—'}</td>
                <td className="num">{fmtNum(p.mine)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
