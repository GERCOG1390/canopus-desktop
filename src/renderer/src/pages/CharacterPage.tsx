import { useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import { Card, Empty, ErrorBox, Loading, ProgressBar, RequireLogin, Sec, Stat, Tabs, TypeIcon } from '../components/ui'
import { esi, imageUrl, resolveNames, systemInfo } from '../lib/esi'
import { fmtDate, fmtDuration, fmtIsk, fmtNum, ROMAN } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { useAsync, useTick } from '../lib/useAsync'

type Tab = 'overview' | 'skills' | 'assets'

export default function CharacterPage() {
  const { active } = useApp()
  const [tab, setTab] = useState<Tab>('overview')
  if (!active) return <RequireLogin what="данные персонажа" />

  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'overview', label: 'Обзор' },
          { id: 'skills', label: 'Навыки' },
          { id: 'assets', label: 'Ассеты' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'overview' && <Overview id={active.id} />}
      {tab === 'skills' && <Skills id={active.id} />}
      {tab === 'assets' && <Assets id={active.id} />}
    </div>
  )
}

// ---------------- Overview ----------------

interface PublicInfo {
  name: string
  corporation_id: number
  alliance_id?: number
  security_status?: number
  birthday: string
}
interface SkillsResponse {
  skills: { skill_id: number; active_skill_level: number; trained_skill_level: number; skillpoints_in_skill: number }[]
  total_sp: number
  unallocated_sp?: number
}
interface QueueEntry {
  skill_id: number
  finished_level: number
  queue_position: number
  start_date?: string
  finish_date?: string
  level_start_sp?: number
  level_end_sp?: number
  training_start_sp?: number
}

const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

function Overview({ id }: { id: number }) {
  const now = useTick(1000)
  const { data, error, loading, reload } = useAsync(async () => {
    const auth = { characterId: id }
    const [info, wallet, skills, queue, location, ship, online] = await Promise.all([
      esi<PublicInfo>(`/characters/${id}/`),
      settle(esi<number>(`/characters/${id}/wallet/`, auth)),
      settle(esi<SkillsResponse>(`/characters/${id}/skills/`, auth)),
      settle(esi<QueueEntry[]>(`/characters/${id}/skillqueue/`, auth)),
      settle(esi<{ solar_system_id: number; station_id?: number; structure_id?: number }>(`/characters/${id}/location/`, auth)),
      settle(esi<{ ship_type_id: number; ship_name: string }>(`/characters/${id}/ship/`, auth)),
      settle(esi<{ online: boolean; last_login?: string }>(`/characters/${id}/online/`, auth))
    ])
    const ids = [info.corporation_id, info.alliance_id ?? 0, location?.solar_system_id ?? 0, location?.station_id ?? 0, ship?.ship_type_id ?? 0]
    queue?.forEach((q) => ids.push(q.skill_id))
    const names = await resolveNames(ids)
    const system = location ? await systemInfo(location.solar_system_id) : null
    let structureName: string | null = null
    if (location?.structure_id) {
      structureName = await esi<{ name: string }>(`/universe/structures/${location.structure_id}/`, auth)
        .then((s) => s.name)
        .catch(() => 'Структура')
    }
    return { info, wallet, skills, queue, location, ship, online, names, system, structureName }
  }, [id])

  if (loading && !data) return <Loading />
  if (!data) return <ErrorBox error={error} />
  const { info, wallet, skills, queue, location, ship, online, names, system, structureName } = data

  const activeQueue = (queue ?? [])
    .filter((q) => !q.finish_date || new Date(q.finish_date).getTime() > now)
    .sort((a, b) => a.queue_position - b.queue_position)
  const queueEnd = activeQueue.at(-1)?.finish_date

  return (
    <>
      <ErrorBox error={error} />
      <Card
        className="hero"
        actions={
          <button className="ghost" onClick={reload}>
            Обновить
          </button>
        }
      >
        <div className="hero-body">
          <img className="portrait" src={imageUrl.portrait(id, 128)} alt="" />
          <div className="hero-main">
            <h2>{info.name}</h2>
            <div className="org">
              <img src={imageUrl.corpLogo(info.corporation_id, 32)} width={20} height={20} alt="" />
              {names.get(info.corporation_id)}
              {info.alliance_id && (
                <>
                  <span className="muted">·</span>
                  <img src={imageUrl.allianceLogo(info.alliance_id, 32)} width={20} height={20} alt="" />
                  {names.get(info.alliance_id)}
                </>
              )}
            </div>
            <div className="muted">
              {online && (online.online ? <span className="online">● в игре</span> : `Последний вход: ${online.last_login ? fmtDate(online.last_login) : '—'}`)}
              {info.security_status !== undefined && <> · Статус безопасности {info.security_status.toFixed(2)}</>}
              {' · '}Создан {fmtDate(info.birthday)}
            </div>
          </div>
          {ship && (
            <div className="hero-ship">
              <img src={imageUrl.typeRender(ship.ship_type_id, 128)} width={96} height={96} alt="" />
              <div>
                <div>{names.get(ship.ship_type_id)}</div>
                <div className="muted">{ship.ship_name}</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="stats-row">
        <Stat label="Кошелёк" value={wallet == null ? '—' : fmtIsk(wallet, true)} sub={wallet == null ? 'нет доступа' : fmtIsk(wallet)} />
        <Stat label="Всего SP" value={fmtNum(skills?.total_sp)} sub={skills?.unallocated_sp ? `Нераспределено: ${fmtNum(skills.unallocated_sp)}` : undefined} />
        <Stat
          label="Местоположение"
          value={
            system ? (
              <>
                <Sec value={system.security_status} /> {system.name}
              </>
            ) : (
              '—'
            )
          }
          sub={location?.station_id ? names.get(location.station_id) : structureName ?? (location ? 'в космосе' : undefined)}
        />
        <Stat label="Очередь навыков" value={queueEnd ? fmtDuration(new Date(queueEnd).getTime() - now) : 'пусто'} sub={`${activeQueue.length} в очереди`} />
      </div>

      <Card title="Очередь обучения">
        {queue === null && <Empty>Нет доступа к очереди (scope esi-skills.read_skillqueue.v1)</Empty>}
        {queue && !activeQueue.length && <Empty>Очередь пуста — персонаж ничего не изучает!</Empty>}
        <ul className="queue">
          {activeQueue.map((q, i) => {
            const start = q.start_date ? new Date(q.start_date).getTime() : 0
            const end = q.finish_date ? new Date(q.finish_date).getTime() : 0
            let progress = 0
            if (i === 0 && start && end && q.level_end_sp && q.level_start_sp !== undefined) {
              const timeFrac = Math.max(0, Math.min(1, (now - start) / (end - start)))
              const startSp = q.training_start_sp ?? q.level_start_sp
              const sp = startSp + (q.level_end_sp - startSp) * timeFrac
              progress = (sp - q.level_start_sp) / (q.level_end_sp - q.level_start_sp)
            }
            return (
              <li key={`${q.skill_id}-${q.finished_level}`}>
                <div className="queue-row">
                  <span>
                    {names.get(q.skill_id)} <b>{ROMAN[q.finished_level]}</b>
                  </span>
                  <span className="muted">{end ? fmtDuration(end - now) : 'на паузе'}</span>
                </div>
                {i === 0 && <ProgressBar value={progress} />}
              </li>
            )
          })}
        </ul>
      </Card>
    </>
  )
}

// ---------------- Skills ----------------

function Skills({ id }: { id: number }) {
  const [filter, setFilter] = useState('')
  const { data, error, loading } = useAsync(async () => {
    const skills = await esi<SkillsResponse>(`/characters/${id}/skills/`, { characterId: id })
    const cat = await esi<{ groups: number[] }>('/universe/categories/16/')
    const groups = await Promise.all(cat.groups.map((g) => esi<{ group_id: number; name: string; types: number[]; published: boolean }>(`/universe/groups/${g}/`)))
    const names = await resolveNames(skills.skills.map((s) => s.skill_id))
    return { skills, groups: groups.filter((g) => g.published), names }
  }, [id])

  if (loading) return <Loading />
  if (!data) return <ErrorBox error={error} />

  const bySkill = new Map(data.skills.skills.map((s) => [s.skill_id, s]))
  const f = filter.trim().toLowerCase()

  return (
    <>
      <div className="toolbar">
        <input placeholder="Фильтр навыков…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">
          Изучено навыков: {data.skills.skills.length} · {fmtNum(data.skills.total_sp)} SP
        </span>
      </div>
      <div className="grid-cards">
        {data.groups
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((g) => {
            const trained = g.types
              .map((t) => bySkill.get(t))
              .filter((s): s is NonNullable<typeof s> => !!s)
              .filter((s) => !f || (data.names.get(s.skill_id) ?? '').toLowerCase().includes(f))
            if (!trained.length) return null
            const sp = trained.reduce((a, s) => a + s.skillpoints_in_skill, 0)
            return (
              <Card key={g.group_id} title={g.name} actions={<span className="muted">{fmtNum(sp)} SP</span>}>
                <ul className="skill-list">
                  {trained
                    .sort((a, b) => (data.names.get(a.skill_id) ?? '').localeCompare(data.names.get(b.skill_id) ?? ''))
                    .map((s) => (
                      <li key={s.skill_id}>
                        <span>{data.names.get(s.skill_id)}</span>
                        <span className="pips" title={`Уровень ${s.active_skill_level}`}>
                          {[1, 2, 3, 4, 5].map((l) => (
                            <i key={l} className={l <= s.active_skill_level ? 'on' : l <= s.trained_skill_level ? 'alpha' : ''} />
                          ))}
                        </span>
                      </li>
                    ))}
                </ul>
              </Card>
            )
          })}
      </div>
    </>
  )
}

// ---------------- Assets ----------------

interface Asset {
  item_id: number
  type_id: number
  location_id: number
  location_type: string
  location_flag: string
  quantity: number
  is_singleton: boolean
  is_blueprint_copy?: boolean
}

interface LocationGroup {
  id: number
  name: string
  items: Map<number, { typeId: number; qty: number; value: number }>
  value: number
  count: number
}

function Assets({ id }: { id: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const [filter, setFilter] = useState('')

  const { data, error, loading } = useAsync(async () => {
    const assets = await esi<Asset[]>(`/characters/${id}/assets/`, { characterId: id, allPages: true })
    const byItem = new Map(assets.map((a) => [a.item_id, a]))
    const rootOf = (a: Asset): number => {
      let cur = a
      for (let guard = 0; guard < 10 && byItem.has(cur.location_id); guard++) cur = byItem.get(cur.location_id)!
      return cur.location_id
    }

    const prices = await jitaPrices(assets.map((a) => a.type_id))
    const groups = new Map<number, LocationGroup>()
    for (const a of assets) {
      const root = rootOf(a)
      const g = groups.get(root) ?? { id: root, name: '', items: new Map(), value: 0, count: 0 }
      const unit = a.is_blueprint_copy ? 0 : prices.get(a.type_id)?.sell.best ?? 0
      const it = g.items.get(a.type_id) ?? { typeId: a.type_id, qty: 0, value: 0 }
      it.qty += a.quantity
      it.value += unit * a.quantity
      g.items.set(a.type_id, it)
      g.value += unit * a.quantity
      g.count += 1
      groups.set(root, g)
    }

    const locIds = [...groups.keys()]
    const names = await resolveNames([...locIds.filter((l) => l < 1e12), ...assets.map((a) => a.type_id)])
    await Promise.all(
      locIds
        .filter((l) => l >= 1e12)
        .map((l) =>
          esi<{ name: string }>(`/universe/structures/${l}/`, { characterId: id })
            .then((s) => names.set(l, s.name))
            .catch(() => names.set(l, `Структура ${l}`))
        )
    )
    for (const g of groups.values()) g.name = names.get(g.id) ?? (g.id === 2004 ? 'Asset Safety' : `Локация ${g.id}`)
    const list = [...groups.values()].sort((a, b) => b.value - a.value)
    return { list, names, total: list.reduce((s, g) => s + g.value, 0), count: assets.length }
  }, [id])

  const f = filter.trim().toLowerCase()
  const visible = useMemo(
    () =>
      (data?.list ?? []).filter(
        (g) => !f || g.name.toLowerCase().includes(f) || [...g.items.keys()].some((t) => (data?.names.get(t) ?? '').toLowerCase().includes(f))
      ),
    [data, f]
  )

  if (loading) return <Loading label="Загрузка ассетов и цен…" />
  if (!data) return <ErrorBox error={error} />

  return (
    <>
      <div className="stats-row">
        <Stat label="Оценка (Jita sell)" value={fmtIsk(data.total, true)} sub="без учёта копий чертежей" />
        <Stat label="Предметов (стеков)" value={fmtNum(data.count)} />
        <Stat label="Локаций" value={fmtNum(data.list.length)} />
      </div>
      <div className="toolbar">
        <input placeholder="Поиск по локации или предмету…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Локация</th>
              <th className="num">Стеков</th>
              <th className="num">Оценка</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <LocationRows key={g.id} group={g} names={data.names} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} filter={f} />
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}

function LocationRows({ group, names, open, onToggle, filter }: { group: LocationGroup; names: Map<number, string>; open: boolean; onToggle: () => void; filter: string }) {
  const items = [...group.items.values()]
    .filter((i) => !filter || group.name.toLowerCase().includes(filter) || (names.get(i.typeId) ?? '').toLowerCase().includes(filter))
    .sort((a, b) => b.value - a.value)
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>
          {open ? '▾' : '▸'} {group.name}
        </td>
        <td className="num">{fmtNum(group.count)}</td>
        <td className="num">{fmtIsk(group.value, true)}</td>
      </tr>
      {open &&
        items.slice(0, 300).map((i) => (
          <tr key={i.typeId} className="sub-row">
            <td>
              <TypeIcon typeId={i.typeId} size={20} /> {names.get(i.typeId) ?? i.typeId}
            </td>
            <td className="num">{fmtNum(i.qty)}</td>
            <td className="num">{fmtIsk(i.value, true)}</td>
          </tr>
        ))}
    </>
  )
}
