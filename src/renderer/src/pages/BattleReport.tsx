// A battle from zKillboard: paste a kill or battle link, or give a system and time.

import { useState } from 'react'
import { useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, SearchBox, Stat } from '../components/ui'
import { esi, imageUrl } from '../lib/esi'
import { fmtIsk, fmtNum } from '../lib/format'
import { searchSystemsSde, tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { battleStamp, parseBattleQuery, summarizeBattle, type BattleQuery, type BattleSide, type Related } from '../../../shared/battleReport'

/** Losses shown per side before "more" */
const LOSSES = 20

async function loadBattle(q: BattleQuery): Promise<{ related: Related; url: string }> {
  let where: { systemId: number; stamp: string }
  if ('killId' in q) {
    const found = await window.api.request<{ killmail_id: number; zkb: { hash: string } }[]>(`https://zkillboard.com/api/killID/${q.killId}/`)
    if (!found?.length) throw new Error('Такого убийства нет на zKillboard.')
    const mail = await esi<{ solar_system_id: number; killmail_time: string }>(`/killmails/${found[0].killmail_id}/${found[0].zkb.hash}/`)
    const stamp = battleStamp(mail.killmail_time)
    if (!stamp) throw new Error('Такого убийства нет на zKillboard.')
    where = { systemId: mail.solar_system_id, stamp }
  } else {
    where = q
  }
  const related = await window.api.request<Related>(`https://zkillboard.com/api/related/${where.systemId}/${where.stamp}/`)
  return { related, url: `https://zkillboard.com/related/${where.systemId}/${where.stamp}/` }
}

function Side({ s, title, groups }: { s: BattleSide; title: string; groups: Record<number, [string, string]> }) {
  const lang = useLang()
  const [all, setAll] = useState(false)
  const shown = all ? s.losses : s.losses.slice(0, LOSSES)
  return (
    <Card title={title}>
      <div className="row">
        {s.entities.slice(0, 8).map((e) => (
          <span key={e.id} className="small">
            <img src={e.type === 'alliance' ? imageUrl.allianceLogo(e.id, 32) : imageUrl.corpLogo(e.id, 32)} width={18} height={18} alt="" /> {e.name}
          </span>
        ))}
        {s.entities.length > 8 && <span className="muted small">{`+${s.entities.length - 8}`}</span>}
      </div>
      <div className="stats-row">
        <Stat label="Потеряно" value={fmtIsk(s.iskLost, true)} sub={`Выпало: ${fmtIsk(s.iskDropped, true)}`} />
        <Stat label="Потери" value={fmtNum(s.shipsLost)} />
        <Stat label="Пилотов" value={fmtNum(s.pilots)} />
        <Stat label="Эффективность" value={`${Math.round(s.efficiency * 100)}%`} />
      </div>
      <table className="table compact">
        <thead>
          <tr>
            <th>Класс</th>
            <th className="num">Было</th>
            <th className="num">Потери</th>
          </tr>
        </thead>
        <tbody>
          {s.fielded.map((f) => (
            <tr key={f.group}>
              <td>{groups[f.groupId] ? tn(groups[f.groupId], lang) : f.group}</td>
              <td className="num">{fmtNum(f.count)}</td>
              <td className="num">{f.lost ? fmtNum(f.lost) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.losses.length > 0 && (
        <table className="table compact">
          <thead>
            <tr>
              <th>Потери</th>
              <th>Пилот</th>
              <th className="num">Цена</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.killId}>
                <td>
                  <TypeLink id={l.shipTypeId} size={20} />
                </td>
                <td className="small">
                  {l.pilot}
                  {l.corporation && <div className="muted small">{l.corporation}</div>}
                </td>
                <td className="num">
                  <a href={`https://zkillboard.com/kill/${l.killId}/`} target="_blank" rel="noreferrer">
                    {fmtIsk(l.value, true)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!all && s.losses.length > LOSSES && (
        <button className="ghost small" onClick={() => setAll(true)}>
          {`Ещё потерь: ${s.losses.length - LOSSES}`}
        </button>
      )}
    </Card>
  )
}

export default function BattleReportTab() {
  const [text, setText] = useState('')
  const [system, setSystem] = useState<{ id: number; name: string } | null>(null)
  const [time, setTime] = useState('')
  const [query, setQuery] = useState<BattleQuery | null>(null)
  const [badInput, setBadInput] = useState(false)

  const go = () => {
    const stamp = battleStamp(time)
    const q = parseBattleQuery(text) ?? (system && stamp ? { systemId: system.id, stamp } : null)
    setBadInput(!q)
    if (q) setQuery(q)
  }

  const data = useAsync(async () => {
    if (!query) return null
    const { related, url } = await loadBattle(query)
    const report = summarizeBattle(related)
    const ids = [...new Set(report.sides.flatMap((s) => s.fielded.map((f) => f.groupId)).filter(Boolean))]
    const groups = ids.length ? await window.api.sde.groupNames(ids) : {}
    return { report, url, groups }
  }, [query])

  const r = data.data?.report
  return (
    <>
      <Card>
        <div className="calc-form">
          <label className="wide">
            Ссылка или номер убийства
            <input
              value={text}
              placeholder="https://zkillboard.com/kill/…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') go()
              }}
            />
          </label>
          <label>
            Система боя
            <SearchBox placeholder="Система…" search={searchSystemsSde} onSelect={setSystem} initial={system?.name ?? ''} />
          </label>
          <label>
            Время, UTC
            <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button onClick={go}>Разобрать бой</button>
        </div>
        {badInput && <p className="warn-text small">Эту ссылку не удалось разобрать.</p>}
      </Card>
      {!query ? (
        <Empty>Вставьте ссылку на бой или убийство с zKillboard либо номер убийства. Можно указать систему и время.</Empty>
      ) : data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorBox error={data.error} />
      ) : !r || r.first === null ? (
        <Empty>В это время здесь никто не погиб.</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Система" value={r.systemName} sub={r.regionName} />
            <Stat label="Уничтожено всего" value={fmtIsk(r.iskDestroyed, true)} />
            <Stat label="Первый и последний бой" value={`${new Date(r.first).toISOString().slice(11, 16)} – ${new Date(r.last ?? r.first).toISOString().slice(11, 16)}`} sub={new Date(r.first).toISOString().slice(0, 10)} />
          </div>
          <p className="small">
            <a href={data.data?.url} target="_blank" rel="noreferrer">
              Открыть на zKillboard
            </a>
          </p>
          <div className="two-col">
            <Side s={r.sides[0]} title="Сторона A" groups={data.data?.groups ?? {}} />
            <Side s={r.sides[1]} title="Сторона B" groups={data.data?.groups ?? {}} />
          </div>
          <p className="muted small">Стороны и суммы считает zKillboard по убийствам в системе за пару часов вокруг выбранного времени. Кто выжил и ничего не убил, в отчёт не попадает, поэтому состав сторон — нижняя оценка.</p>
        </>
      )}
    </>
  )
}
