import { useMemo, useState } from 'react'
import type { IntelReport, Threat } from '../../../shared/intel'
import { useApp } from '../AppContext'
import { REPORT_FRESH_MS, useIntel } from '../IntelContext'
import { TypeLink } from '../components/TypeLink'
import { GameButton } from '../components/GameButton'
import { addContacts, SCOPE } from '../lib/gameActions'
import { Card, Empty, Sec, Stat, Tabs } from '../components/ui'
import { imageUrl } from '../lib/esi'
import { fmtNum } from '../lib/format'
import { ON_GRID_KM, sortPilots, THREAT_LABEL, THREAT_ORDER, type PilotIntel } from '../lib/intel'
import { getBasic, tn, useTypeBasics } from '../lib/sde'
import { useAsync, useTick } from '../lib/useAsync'
import { useLang } from '../AppContext'

type Tab = 'local' | 'dscan' | 'fleet' | 'channels' | 'settings'

export default function IntelPage() {
  const [tab, setTab] = useState<Tab>('local')
  const { lastClipboard } = useIntel()
  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'local', label: 'Локал' },
          { id: 'dscan', label: 'D-scan' },
          { id: 'fleet', label: 'Флот' },
          { id: 'channels', label: 'Каналы разведки' },
          { id: 'settings', label: 'Настройки разведки' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {lastClipboard && Date.now() - lastClipboard.at < 4000 && lastClipboard.kind !== tab && tab !== 'settings' && tab !== 'channels' && (
        <div className="clip-toast" onClick={() => lastClipboard.kind !== 'probe' && setTab(lastClipboard.kind)}>
          Из буфера получен {lastClipboard.kind === 'local' ? 'список локала' : lastClipboard.kind === 'dscan' ? 'D-scan' : 'состав флота'} — открыть
        </div>
      )}
      {tab === 'local' && <LocalTab />}
      {tab === 'dscan' && <DscanTab />}
      {tab === 'fleet' && <FleetTab />}
      {tab === 'channels' && <ChannelsTab />}
      {tab === 'settings' && <IntelSettingsTab />}
    </div>
  )
}

// ---------------- Local ----------------

const ago = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s} с назад` : s < 3600 ? `${Math.floor(s / 60)} мин назад` : `${Math.floor(s / 3600)} ч назад`
}

function ThreatBadge({ threat }: { threat: Threat }) {
  return <span className={`threat threat-${threat}`}>{THREAT_LABEL[threat]}</span>
}

function LocalTab() {
  const { system, scan, logStatus, scanText } = useIntel()
  const { navigate } = useApp()
  const now = useTick(5000)
  const [filter, setFilter] = useState<{ kind: 'alliance' | 'corp'; id: number } | null>(null)
  const [manual, setManual] = useState('')
  const pilots = useMemo(() => sortPilots(scan?.pilots ?? []), [scan])
  useTypeBasics(pilots.flatMap((p) => p.zkb?.recentShips.slice(0, 3).map((s) => s.typeId) ?? []))

  const groups = useMemo(() => {
    const m = new Map<string, { kind: 'alliance' | 'corp'; id: number; ticker: string; name: string; count: number; danger: number }>()
    for (const p of pilots) {
      const kind = p.allianceId ? 'alliance' : 'corp'
      const id = p.allianceId ?? p.corpId
      if (!id) continue
      const key = `${kind}:${id}`
      const g = m.get(key) ?? { kind, id, ticker: (p.allianceTicker ?? p.corpTicker) || '?', name: (p.allianceName ?? p.corpName) || '', count: 0, danger: 0 }
      g.count++
      if (p.threat === 'high' || p.threat === 'hostile') g.danger++
      m.set(key, g)
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [pilots])

  const shown = filter ? pilots.filter((p) => (filter.kind === 'alliance' ? p.allianceId === filter.id : p.corpId === filter.id && !p.allianceId)) : pilots
  const stale = scan && system && scan.system !== system.name
  const counts = Object.fromEntries(THREAT_ORDER.map((t) => [t, pilots.filter((p) => p.threat === t).length])) as Record<Threat, number>

  return (
    <>
      <Card>
        <div className="intel-head">
          <div>
            <div className="muted small">Текущая система (из лога Local)</div>
            <div className="intel-system">
              {system ? (
                <>
                  {system.sec !== undefined && <Sec value={system.sec} />} {system.name}
                </>
              ) : (
                <span className="muted">{logStatus?.error ?? 'ожидаю лог…'}</span>
              )}
            </div>
          </div>
          <div className="grow" />
          <div className="intel-help small muted">
            В игре: окно Local → <b>Ctrl+A</b>, <b>Ctrl+C</b>. Canopus увидит список в буфере и проверит всех автоматически.
          </div>
        </div>
        {stale && <div className="warn">Скан из системы {scan!.system ?? '?'} — вы уже в {system!.name}. Скопируйте Local заново.</div>}
      </Card>

      {!scan ? (
        <Card>
          <Empty>Скопируйте список пилотов из окна Local (Ctrl+A, Ctrl+C) — или вставьте его сюда:</Empty>
          <textarea rows={5} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Имена пилотов, по одному в строке" />
          <div className="row">
            <button disabled={!manual.trim()} onClick={() => scanText(manual)}>
              Проверить
            </button>
          </div>
        </Card>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Пилотов" value={pilots.length} sub={scan.running ? 'проверяю…' : `скан ${ago(now - scan.scannedAt)}`} />
            <Stat
              label="Опасных"
              value={
                <span className={counts.hostile + counts.high ? 'bad' : 'good'}>
                  {counts.hostile + counts.high}
                </span>
              }
              sub={`врагов ${counts.hostile} · опасных ${counts.high} · внимание ${counts.medium}`}
            />
            <Stat label="Своих" value={counts.friendly} />
            <Stat label="Изменения" value={`+${scan.arrived.size} / −${scan.left.length}`} sub={scan.left.length ? `ушли: ${scan.left.slice(0, 4).join(', ')}${scan.left.length > 4 ? '…' : ''}` : 'с прошлого скана'} />
          </div>

          {groups.length > 1 && (
            <div className="group-chips">
              {groups.slice(0, 16).map((g) => (
                <button
                  key={`${g.kind}${g.id}`}
                  className={`group-chip ${filter?.id === g.id ? 'active' : ''}`}
                  title={g.name}
                  onClick={() => setFilter(filter?.id === g.id ? null : { kind: g.kind, id: g.id })}
                >
                  <img src={g.kind === 'alliance' ? imageUrl.allianceLogo(g.id, 32) : imageUrl.corpLogo(g.id, 32)} width={18} height={18} alt="" />
                  {g.ticker} <b>{g.count}</b>
                  {g.danger > 0 && <span className="bad"> ⚠{g.danger}</span>}
                </button>
              ))}
            </div>
          )}

          {counts.hostile + counts.high > 0 && (
            <div className="row">
              <GameButton
                scope={SCOPE.writeContacts}
                confirm={`Добавить опасных пилотов (${pilots.filter((p) => p.threat === 'high' || p.threat === 'hostile').length}) в контакты с ужасной репутацией (−10)?`}
                action={(who) => addContacts(who, pilots.filter((p) => p.threat === 'high' || p.threat === 'hostile').map((p) => p.id), -10)}
                title="Опасные пилоты будут видны красными в игре"
                done="добавлены"
              >
                {`Опасных в контакты (−10): ${counts.hostile + counts.high}`}
              </GameButton>
            </div>
          )}
          <Card>
            <table className="table intel-table">
              <thead>
                <tr>
                  <th>Угроза</th>
                  <th>Пилот</th>
                  <th>Корпорация / альянс</th>
                  <th className="num">Возраст</th>
                  <th className="num" title="Уничтожено / потеряно всего">K / L</th>
                  <th className="num" title="Киллов за последние 7 дней / ~3 месяца">Активность</th>
                  <th className="num" title="Опасность / соло">Опасн.</th>
                  <th>Летает на</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <PilotRow key={p.id} p={p} isNew={scan.arrived.has(p.id)} onOpen={() => navigate('pvp', p.id)} />
                ))}
              </tbody>
            </table>
            {scan.unknown.length > 0 && <p className="muted small">Не найдены: {scan.unknown.join(', ')}</p>}
            <p className="muted small">
              Угроза — оценка по стендингам и статистике zKillboard. «Опасен»: активный PvP-пилот (киллы за неделю или много за последние месяцы при высоком проценте опасности).
              Клик по пилоту — подробная статистика.
            </p>
          </Card>
        </>
      )}
    </>
  )
}

function PilotRow({ p, isNew, onOpen }: { p: PilotIntel; isNew: boolean; onOpen: () => void }) {
  const lang = useLang()
  const years = p.birthday ? (Date.now() - new Date(p.birthday).getTime()) / (365.25 * 86400_000) : null
  return (
    <tr className={`clickable ${isNew ? 'arrived' : ''} rel-${p.relation}`} onClick={onOpen}>
      <td>
        <ThreatBadge threat={p.threat} />
        {isNew && <span className="new-badge">новый</span>}
      </td>
      <td>
        <span className="with-icon">
          <img src={imageUrl.portrait(p.id, 32)} width={24} height={24} alt="" className="portrait-sm" />
          <span>
            {p.name}
            {p.source === 'chat' && <span className="muted small"> · из чата</span>}
          </span>
        </span>
      </td>
      <td className="small">
        {p.corpTicker && <span className="ticker">[{p.corpTicker}]</span>} {p.allianceTicker && <span className="ticker">&lt;{p.allianceTicker}&gt;</span>}
        <div className="muted">{p.allianceName ?? p.corpName}</div>
      </td>
      <td className="num muted">{years === null ? '' : years < 1 ? `${Math.round(years * 12)} мес` : `${years.toFixed(1)} г`}</td>
      <td className="num">{p.zkb === undefined ? '…' : p.zkb ? `${fmtNum(p.zkb.kills)} / ${fmtNum(p.zkb.losses)}` : '—'}</td>
      <td className="num">{p.zkb ? `${p.zkb.activeWeek} / ${p.zkb.recentKills}` : ''}</td>
      <td className="num">{p.zkb ? `${p.zkb.danger}%${p.zkb.soloKills ? ` · соло ${p.zkb.soloKills}` : ''}` : ''}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <span className="ship-icons">
          {p.zkb?.recentShips.slice(0, 3).map((s) => (
            <span key={s.typeId} title={`${tn(getBasic(s.typeId)?.n, lang)}: ${s.kills} киллов, ${s.losses} потерь`}>
              <TypeLink id={s.typeId} size={24} className="icon-only" />
            </span>
          ))}
        </span>
      </td>
    </tr>
  )
}

// ---------------- D-scan ----------------

const NOTABLE_GROUPS: Record<number, string> = {
  541: 'Интердикторы',
  894: 'Хэви-интердикторы',
  833: 'Форс-реконы',
  906: 'Комбат-реконы',
  834: 'Стелс-бомберы',
  832: 'Логистика',
  1527: 'Логистические фрегаты',
  898: 'Black Ops',
  547: 'Карриеры',
  485: 'Дредноуты',
  1538: 'Force Auxiliary',
  659: 'Суперкарриеры',
  30: 'Титаны',
  361: 'Бабл-генераторы'
}

function DscanTab() {
  const lang = useLang()
  const { dscan, setDscanText } = useIntel()
  const [text, setText] = useState('')
  const rows = dscan?.rows ?? []
  useTypeBasics(rows.map((r) => r.typeId))

  const summary = useMemo(() => {
    const byType = new Map<number, { total: number; grid: number }>()
    for (const r of rows) {
      const e = byType.get(r.typeId) ?? { total: 0, grid: 0 }
      e.total++
      if (r.distanceKm !== null && r.distanceKm <= ON_GRID_KM) e.grid++
      byType.set(r.typeId, e)
    }
    return byType
  }, [rows])

  const typeIds = [...summary.keys()]
  const ships = typeIds.filter((id) => getBasic(id)?.c === 6)
  const byGroup = new Map<number, number>()
  ships.forEach((id) => byGroup.set(getBasic(id)!.g, (byGroup.get(getBasic(id)!.g) ?? 0) + summary.get(id)!.total))
  const shipCount = ships.reduce((s, id) => s + summary.get(id)!.total, 0)
  const notable = [...byGroup.entries()].filter(([g]) => NOTABLE_GROUPS[g])
  const groupKey = [...byGroup.keys()].sort().join(',')
  const groups = useAsync(() => window.api.sde.groupNames([...byGroup.keys()]), [groupKey])
  const others = typeIds.filter((id) => getBasic(id)?.c !== 6).sort((a, b) => summary.get(b)!.total - summary.get(a)!.total)

  return (
    <>
      <Card>
        <p className="muted small">
          В игре: окно направленного сканера → <b>Ctrl+A</b>, <b>Ctrl+C</b>. Canopus разберёт результат автоматически. Или вставьте вручную:
        </p>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button disabled={!text.trim()} onClick={() => setDscanText(text)}>
            Разобрать
          </button>
        </div>
      </Card>
      {!dscan ? (
        <Empty>Результатов D-scan пока нет.</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Объектов" value={rows.length} />
            <Stat label="Кораблей" value={shipCount} sub={`на гриде: ${ships.reduce((s, id) => s + summary.get(id)!.grid, 0)}`} />
            <Stat label="Типов кораблей" value={ships.length} />
          </div>
          {notable.length > 0 && (
            <div className="warn-box">
              {notable.map(([g, n]) => (
                <div key={g}>
                  ⚠ {NOTABLE_GROUPS[g]}: <b>{n}</b>
                </div>
              ))}
            </div>
          )}
          <div className="two-col">
            <Card title="Корабли по классам">
              <table className="table compact">
                <tbody>
                  {[...byGroup.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([g, n]) => (
                      <tr key={g}>
                        <td>{tn(groups.data?.[g], lang) || g}</td>
                        <td className="num">
                          <b>{n}</b>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
            <Card title="Корабли по типам">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th className="num">Всего</th>
                    <th className="num">На гриде</th>
                  </tr>
                </thead>
                <tbody>
                  {ships
                    .sort((a, b) => summary.get(b)!.total - summary.get(a)!.total)
                    .map((id) => (
                      <tr key={id}>
                        <td>
                          <TypeLink id={id} />
                        </td>
                        <td className="num">{summary.get(id)!.total}</td>
                        <td className="num">{summary.get(id)!.grid || ''}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          </div>
          {others.length > 0 && (
            <Card title="Прочее (структуры, дроны, объекты)">
              <div className="link-grid">
                {others.map((id) => (
                  <span key={id}>
                    <TypeLink id={id} /> <span className="muted">×{summary.get(id)!.total}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  )
}


// ---------------- Fleet ----------------

function FleetTab() {
  const { fleet, setFleetText } = useIntel()
  const [text, setText] = useState('')
  const rows = fleet?.rows ?? []
  const counts = new Map<number, number>()
  rows.forEach((r) => r.typeId && counts.set(r.typeId, (counts.get(r.typeId) ?? 0) + 1))
  useTypeBasics([...counts.keys()])
  return (
    <>
      <Card>
        <p className="muted small">
          В игре: окно флота → выделите участников → <b>Ctrl+C</b>. Или вставьте вручную:
        </p>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button disabled={!text.trim()} onClick={() => void setFleetText(text)}>
            Разобрать
          </button>
        </div>
      </Card>
      {!fleet ? (
        <Empty>Состав флота пока не получен.</Empty>
      ) : (
        <div className="two-col">
          <Card title={`Состав: ${rows.length} пилотов`}>
            <table className="table compact">
              <tbody>
                {[...counts.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, n]) => (
                    <tr key={id}>
                      <td>
                        <TypeLink id={id} />
                      </td>
                      <td className="num">
                        <b>{n}</b>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
          <Card title="Пилоты">
            <table className="table compact">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.pilot}</td>
                    <td>{r.typeId ? <TypeLink id={r.typeId} /> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  )
}

// ---------------- Intel channels ----------------

const JUMP_OPTIONS = [0, 1, 2, 3, 4, 5, 7, 10]

function JumpsBadge({ jumps, alert }: { jumps: number | undefined; alert: number }) {
  if (jumps === undefined) return <span className="jumps jumps-far">далеко</span>
  const cls = jumps <= Math.max(alert, 0) ? 'jumps-near' : jumps <= 10 ? 'jumps-mid' : 'jumps-far'
  return <span className={`jumps ${cls}`}>{jumps === 0 ? 'здесь' : `${jumps} прыж.`}</span>
}

function ChannelsTab() {
  const { settings, updateSettings } = useApp()
  const { reports, channels, jumps, systems, system } = useIntel()
  const now = useTick(5000)
  const [onlyNear, setOnlyNear] = useState(false)
  const [custom, setCustom] = useState('')
  const known = useAsync(() => window.api.intel.listChannels(), [])
  useTypeBasics(reports.flatMap((r) => r.ships))
  if (!settings) return null
  const intel = settings.intel
  const watched = intel.channels
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const setChannels = (list: string[]) => updateSettings({ intel: { ...intel, channels: list } })
  const toggle = (name: string) => setChannels(watched.some((w) => same(w, name)) ? watched.filter((w) => !same(w, name)) : [...watched, name])
  const addCustom = () => {
    const name = custom.trim()
    if (name && !watched.some((w) => same(w, name))) setChannels([...watched, name])
    setCustom('')
  }
  const candidates = [
    ...new Map([...watched.map((n) => [n.toLowerCase(), n] as const), ...(known.data ?? []).map((c) => [c.name.toLowerCase(), c.name] as const)]).values()
  ]
  const radius = intel.channelJumps
  const nearest = (r: IntelReport) => r.systems.filter((id) => jumps[id] !== undefined).sort((a, b) => jumps[a] - jumps[b])[0]
  const feed = [...reports].reverse().filter((r) => {
    if (!onlyNear) return true
    const n = nearest(r)
    return n !== undefined && jumps[n] <= Math.max(radius, 5)
  })
  const fresh = reports.filter((r) => now - new Date(r.at).getTime() < REPORT_FRESH_MS && !r.clear)
  const closest = fresh
    .filter((r) => nearest(r) !== undefined)
    .sort((a, b) => jumps[nearest(a)] - jumps[nearest(b)] || b.at.localeCompare(a.at))[0]

  return (
    <>
      <div className="two-col">
        <Card title="Каналы для отслеживания">
          <p className="muted small">
            Canopus читает логи выбранных каналов (как RIFT), находит в сообщениях системы и корабли и считает прыжки от вашей текущей системы. Канал должен быть открыт в игре.
          </p>
          {candidates.length === 0 ? (
            <p className="muted small">В логах за последние две недели каналов не найдено — впишите название вручную.</p>
          ) : (
            <div className="channel-list">
              {candidates.map((name) => {
                const on = watched.some((w) => same(w, name))
                const st = channels.find((c) => same(c.name, name))
                return (
                  <label key={name} className="check">
                    <input type="checkbox" checked={on} onChange={() => toggle(name)} />
                    {name}
                    {on && <span className={`small ${st?.file ? 'good' : 'muted'}`}>{st?.file ? 'лог найден' : 'лог не найден — откройте канал в игре'}</span>}
                  </label>
                )
              })}
            </div>
          )}
          <div className="row">
            <input
              className="grow"
              value={custom}
              placeholder="Название канала, например Delve Intel"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCustom()
              }}
            />
            <button disabled={!custom.trim()} onClick={addCustom}>
              Добавить
            </button>
            <button className="ghost" onClick={known.reload}>
              Обновить список
            </button>
          </div>
        </Card>
        <Card title="Оповещения">
          <label>
            Уведомлять о репортах в радиусе
            <select value={radius} onChange={(e) => updateSettings({ intel: { ...intel, channelJumps: Number(e.target.value) } })}>
              <option value={-1}>Не уведомлять</option>
              {JUMP_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Только моя система' : `До ${n} прыж.`}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Уведомление Windows (и звук, если он включён) приходит, когда в канале пишут о системе в этом радиусе. Сообщения «clr», «clear», «nv», «чисто» не тревожат.
          </p>
          <p className="small">
            <span className="muted">Текущая система (из лога Local):</span> <b>{system?.name ?? 'неизвестна'}</b>
          </p>
          <div className="stats-row">
            <Stat label="Репортов за 15 мин" value={fresh.length} />
            <Stat
              label="Ближайший"
              value={closest ? (systems[nearest(closest)]?.n ?? '…') : '—'}
              sub={closest ? <JumpsBadge jumps={jumps[nearest(closest)]} alert={radius} /> : 'нет свежих репортов'}
            />
          </div>
        </Card>
      </div>

      <Card
        title="Лента"
        actions={
          <label className="check small">
            <input type="checkbox" checked={onlyNear} onChange={(e) => setOnlyNear(e.target.checked)} />
            Только рядом
          </label>
        }
      >
        {!watched.length ? (
          <Empty>Выберите хотя бы один канал разведки выше.</Empty>
        ) : !feed.length ? (
          <Empty>Сообщений пока нет — они появятся, как только в канале кто-то напишет.</Empty>
        ) : (
          <table className="table intel-feed">
            <tbody>
              {feed.map((r) => {
                const near = nearest(r)
                const age = now - new Date(r.at).getTime()
                const alert = !r.clear && near !== undefined && radius >= 0 && jumps[near] <= radius
                return (
                  <tr key={r.id} className={`${alert ? 'report-alert' : ''} ${r.clear ? 'report-clear' : ''} ${age > REPORT_FRESH_MS ? 'report-old' : ''}`}>
                    <td className="muted small nowrap">{ago(age)}</td>
                    <td className="nowrap">
                      {r.systems.map((id) => (
                        <span key={id} className="report-system">
                          {systems[id] && <Sec value={systems[id].sec} />}
                          <span>{systems[id]?.n ?? '…'}</span>
                          <JumpsBadge jumps={jumps[id]} alert={radius} />
                        </span>
                      ))}
                      {r.clear && <span className="threat threat-friendly">чисто</span>}
                    </td>
                    <td>
                      <span className="ship-icons">
                        {r.ships.map((id) => (
                          <TypeLink key={id} id={id} size={24} className="icon-only" />
                        ))}
                      </span>
                    </td>
                    <td className="report-text">
                      <span className="muted small" translate="no">{`${r.channel} · ${r.speaker}`}</span>
                      <div translate="no">{r.message}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}

// ---------------- Settings ----------------

function IntelSettingsTab() {
  const { settings, updateSettings } = useApp()
  const { logStatus } = useIntel()
  if (!settings) return null
  const intel = settings.intel
  const set = (patch: Partial<typeof intel>) => updateSettings({ intel: { ...intel, ...patch } })
  const setOverlay = (patch: Partial<typeof intel.overlay>) => void window.api.intel.setOverlay(patch).then(() => updateSettings({}))

  return (
    <div className="two-col">
      <Card title="Автоматика">
        <label className="check">
          <input type="checkbox" checked={intel.clipboard} onChange={(e) => set({ clipboard: e.target.checked })} />
          Сканировать при копировании Local / D-scan / флота (Ctrl+A, Ctrl+C в игре)
        </label>
        <label className="check">
          <input type="checkbox" checked={intel.scanSpeakers} onChange={(e) => set({ scanSpeakers: e.target.checked })} />
          Проверять пилотов, которые пишут в Local
        </label>
        <div className="row">
          <label>
            Уведомлять о новых пилотах в локале
            <select value={intel.alertLevel} onChange={(e) => set({ alertLevel: e.target.value as typeof intel.alertLevel })}>
              <option value="off">Не уведомлять</option>
              <option value="hostile">Только враги по стендингам</option>
              <option value="high">Враги и опасные</option>
              <option value="medium">Враги, опасные и «внимание»</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={intel.sound} onChange={(e) => set({ sound: e.target.checked })} />
          Звуковой сигнал
        </label>
        <div className="row">
          <label className="grow">
            Папка логов чата (пусто — найти автоматически)
            <input value={intel.logDir} placeholder={logStatus?.dir ?? 'Документы\\EVE\\logs\\Chatlogs'} onChange={(e) => set({ logDir: e.target.value })} />
          </label>
        </div>
        <p className="muted small">
          {logStatus?.file ? `Читаю: ${logStatus.file.split(/[\\/]/).pop()}` : logStatus?.error ?? 'Лог ещё не найден'}
        </p>
      </Card>

      <Card title="Оверлей поверх игры">
        <label className="check">
          <input type="checkbox" checked={intel.overlay.enabled} onChange={(e) => setOverlay({ enabled: e.target.checked })} />
          Показывать оверлей
        </label>
        <label className="check">
          <input type="checkbox" checked={intel.overlay.clickThrough} onChange={(e) => setOverlay({ clickThrough: e.target.checked })} />
          Сквозные клики (мышь проходит в игру)
        </label>
        <label>
          Прозрачность: {Math.round(intel.overlay.opacity * 100)}%
          <input type="range" min={0.3} max={1} step={0.05} value={intel.overlay.opacity} onChange={(e) => setOverlay({ opacity: Number(e.target.value) })} />
        </label>
        <ul className="muted small hotkeys">
          <li>
            <b>Ctrl+Shift+L</b> — показать / скрыть оверлей
          </li>
          <li>
            <b>Ctrl+Shift+K</b> — включить / выключить сквозные клики
          </li>
          <li>Перетаскивайте оверлей за заголовок, размер — за края.</li>
          <li>Игра должна быть в оконном режиме или «окно без рамки» — поверх эксклюзивного полноэкранного режима Windows окна не показывает.</li>
        </ul>
      </Card>
    </div>
  )
}
