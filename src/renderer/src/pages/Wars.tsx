// Wars in New Eden: which are running and whether they concern this pilot. ESI has no "my wars", so the latest
// wars are read one by one, on request rather than on opening the tab.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import { Card, Empty, ProgressBar, Stat } from '../components/ui'
import { esi, imageUrl, resolveNames } from '../lib/esi'
import { fmtDate, fmtIsk, fmtNum } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { limitedFor } from '../../../shared/esiLimit'
import { WAR_PORTION, rememberWars, warBudget, sideId, sortWars, warRole, warsToRead, warStatus, type War, type WarMemory, type WarRole, type WarSide, type WarStatus } from '../../../shared/wars'

const CONCURRENCY = 8
const MAX_ERRORS = 20
const SHOWN = 200
const MEMORY_KEY = 'wars.memory'
/** Read this session; kept so that returning to the tab or reading further doesn't lose any */
const seen = new Map<number, War>()

const STATUS: Record<WarStatus, string> = { active: 'Идёт', ending: 'Заканчивается', pending: 'Объявлена', finished: 'Закончилась' }
const ROLE: Record<WarRole, string> = { aggressor: 'Агрессор', defender: 'Защитник', ally: 'Союзник' }

function SideCell({ s, names }: { s: WarSide; names: Map<number, string> }) {
  const id = sideId(s)
  return (
    <>
      <img src={s.alliance_id ? imageUrl.allianceLogo(id, 32) : imageUrl.corpLogo(id, 32)} width={20} height={20} alt="" /> {names.get(id) ?? id}
      <div className="muted small">{`${fmtNum(s.ships_killed ?? 0)} · ${fmtIsk(s.isk_destroyed ?? 0, true)}`}</div>
    </>
  )
}

export default function Wars() {
  const { active } = useApp()
  const [wars, setWars] = useState<War[] | null>(seen.size ? [...seen.values()] : null)
  const [names, setNames] = useState(new Map<number, string>())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failed, setFailed] = useState(0)
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null)
  const [capSeconds, setCapSeconds] = useState<number | null>(null)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'mine' | 'running'>('running')
  const [query, setQuery] = useState('')
  const run = useRef(0)
  useEffect(
    () => () => {
      run.current++
    },
    []
  )

  const me = useAsync(async () => {
    if (!active) return {}
    const c = await esi<{ corporation_id: number; alliance_id?: number }>(`/characters/${active.id}/`)
    return { corporationId: c.corporation_id, allianceId: c.alliance_id }
  }, [active?.id])
  const mine = me.data ?? {}

  const load = async () => {
    const token = ++run.current
    setError(null)
    setFailed(0)
    setWaitSeconds(null)
    setCapSeconds(null)
    setProgress({ done: 0, total: 0 })
    try {
      const ids = await esi<number[]>('/wars/')
      const memory = (await window.api.store.get<WarMemory>(MEMORY_KEY)) ?? { finished: [], running: [] }
      const { budget, waitSeconds: wait } = warBudget(memory, Date.now())
      if (budget === 0) {
        setCapSeconds(wait)
        return
      }
      const { read, unread: left } = warsToRead(ids, memory, budget)
      setProgress({ done: 0, total: read.length })
      const got: War[] = []
      let next = 0
      let done = 0
      let errors = 0
      let limited: number | null = null
      const worker = async () => {
        while (next < read.length && errors < MAX_ERRORS && limited === null && run.current === token) {
          const id = read[next++]
          try {
            got.push(await esi<War>(`/wars/${id}/`))
          } catch (e) {
            limited = limitedFor(e instanceof Error ? e.message : String(e))
            if (limited === null) errors++
          }
          done++
          if (done % 20 === 0 && run.current === token) setProgress({ done, total: read.length })
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      // Every request is spent from the ESI limit, those that failed and those of a scan left half-way too.
      await window.api.store.set(MEMORY_KEY, rememberWars(memory, got, Date.now(), done))
      if (run.current !== token) return
      for (const w of got) seen.set(w.id, w)
      setNames(await resolveNames([...seen.values()].flatMap((w) => [sideId(w.aggressor), sideId(w.defender)])))
      if (run.current !== token) return
      setFailed(errors)
      setWaitSeconds(limited)
      setUnread(left + read.length - got.length)
      setWars([...seen.values()])
    } catch (e) {
      if (run.current !== token) return
      const message = e instanceof Error ? e.message : String(e)
      const wait = limitedFor(message)
      if (wait === null) setError(message)
      else setWaitSeconds(wait)
    } finally {
      if (run.current === token) setProgress(null)
    }
  }

  const now = Date.now()
  const myWars = useMemo(() => (wars ?? []).filter((w) => warRole(w, mine)), [wars, me.data])
  const running = (w: War): boolean => {
    const s = warStatus(w, now)
    return s === 'active' || s === 'ending' || s === 'pending'
  }
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (wars ?? []).filter((w) => {
      if (!running(w)) return false
      if (filter === 'mine' && !warRole(w, mine)) return false
      if (!q) return true
      return [sideId(w.aggressor), sideId(w.defender)].some((id) => (names.get(id) ?? '').toLowerCase().includes(q))
    })
    return sortWars(list, mine, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wars, filter, query, names, me.data])

  return (
    <>
      <Card title="Войны">
        <div className="row">
          <button onClick={() => void load()} disabled={!!progress}>
            {unread > 0 && wars ? `Смотреть дальше: ещё ${fmtNum(Math.min(WAR_PORTION, unread))}` : 'Проверить войны'}
          </button>
          <div className="tabs">
          {[
            ['running', 'Идут'],
            ['mine', 'Мои']
          ].map(([id, label]) => (
            <button key={id} className={filter === id ? 'tab active' : 'tab'} onClick={() => setFilter(id as typeof filter)}>
              {label}
            </button>
          ))}
          </div>
          <input placeholder="Поиск по названию" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {progress && (
          <>
            <ProgressBar value={progress.total ? progress.done / progress.total : 0} />
            <p className="muted small">{progress.total ? `Просмотрено войн: ${fmtNum(progress.done)} из ${fmtNum(progress.total)}` : 'Загружаю список войн…'}</p>
          </>
        )}
        {error && <p className="warn-text small">{error}</p>}
        {failed > 0 && <p className="warn-text small">{`Не загрузилось войн: ${failed}`}</p>}
        {capSeconds !== null && <p className="warn-text small">{`Войны уже проверялись много раз подряд. Чтобы не сломать убийства в других экранах, повторить можно через минут: ${Math.ceil(capSeconds / 60)}`}</p>}
        {waitSeconds !== null && <p className="warn-text small">{`ESI просит подождать, минут: ${Math.ceil(waitSeconds / 60)}. Что успели прочитать, сохранено.`}</p>}
      </Card>
      {!wars ? (
        !progress && <Empty>На ESI нет запроса «мои войны», поэтому войны просматриваются по одной. Нажмите «Проверить войны».</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Ваши войны" value={fmtNum(myWars.filter(running).length)} sub={active ? active.name : undefined} />
            <Stat label="Идут" value={fmtNum(wars.filter(running).length)} />
            <Stat label="Не проверено" value={fmtNum(unread)} sub={unread > 0 ? 'ваша война может быть среди них' : undefined} />
          </div>
          {shown.length === 0 ? (
            <Empty>Войн не найдено.</Empty>
          ) : (
            <Card title={`Войн: ${shown.length}`}>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Агрессор</th>
                    <th>Защитник</th>
                    <th>Состояние</th>
                    <th className="num">Начало</th>
                    <th className="num">Конец</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, SHOWN).map((w) => {
                    const role = warRole(w, mine)
                    const status = warStatus(w, now)
                    return (
                      <tr key={w.id}>
                        <td>
                          <SideCell s={w.aggressor} names={names} />
                        </td>
                        <td>
                          <SideCell s={w.defender} names={names} />
                        </td>
                        <td className="small">
                          <a href={`https://zkillboard.com/war/${w.id}/`} target="_blank" rel="noreferrer">
                            <span className={status === 'finished' ? 'muted' : 'good'}>{STATUS[status]}</span>
                          </a>
                          {role && <div className="warn-text">{ROLE[role]}</div>}
                          {w.mutual && <div className="muted">Взаимная</div>}
                          {w.open_for_allies && status !== 'finished' && <div className="muted">Ищет союзников</div>}
                        </td>
                        <td className="num small">{w.started ? fmtDate(w.started) : '—'}</td>
                        <td className="num small">{w.finished ? fmtDate(w.finished) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          )}
          <p className="muted small">Смотрятся последние 2000 войн, порциями: у них с убийствами общий лимит ESI, поэтому закончившиеся запоминаются и больше не запрашиваются. Война старше этого, например долгая взаимная, здесь не появится. Числа убитых и ISK — как их считает ESI, они часто отстают.</p>
        </>
      )}
    </>
  )
}
