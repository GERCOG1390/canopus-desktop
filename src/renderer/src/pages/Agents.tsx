// Mission agents: by level, division or locators, in highsec or anywhere, found by name or corporation, with
// the jumps from a chosen system (the character's by default). A button opens the agent in the game client.

import { useEffect, useState } from 'react'
import { useApp, useLang } from '../AppContext'
import { GameButton } from '../components/GameButton'
import { Card, Empty, Loading, SearchBox, Sec } from '../components/ui'
import { esi, imageUrl, systemInfo } from '../lib/esi'
import { openInfoInGame, SCOPE } from '../lib/gameActions'
import { searchSystemsSde, tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'

const DIVISIONS: [number, string][] = [
  [24, 'Служба безопасности'],
  [22, 'Отдел сбыта'],
  [23, 'Отдел добычи'],
  [18, 'Исследования'],
  [0, 'Любой']
]
const LIMIT = 150

export default function Agents() {
  const { active, sde } = useApp()
  const lang = useLang()
  const [level, setLevel] = useState(4)
  const [division, setDivision] = useState(24)
  const [locators, setLocators] = useState(false)
  const [highsec, setHighsec] = useState(true)
  const [q, setQ] = useState('')
  const [text, setText] = useState('')
  const [from, setFrom] = useState<{ id: number; name: string } | null>(null)

  // Typing doesn't ask for the list on every letter.
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 200)
    return () => clearTimeout(t)
  }, [text])

  // Start from where the character is (when the permission is there).
  useEffect(() => {
    if (!active) return
    let live = true
    void esi<{ solar_system_id: number }>(`/characters/${active.id}/location/`, { characterId: active.id })
      .then((l) => systemInfo(l.solar_system_id).then((s) => live && setFrom((f) => f ?? { id: l.solar_system_id, name: s.name })))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [active?.id])

  const agents = useAsync(
    () => window.api.sde.agents({ level, division, locators, highsec, q, from: from?.id, limit: LIMIT }),
    [level, division, locators, highsec, q, from?.id, sde.state, sde.build]
  )

  if (sde.state === 'downloading' || sde.state === 'building') {
    return <Loading label={`База SDE обновляется${sde.progress ? ` — ${Math.round(sde.progress * 100)}%` : ''}…`} />
  }

  return (
    <>
      <Card title="Агенты">
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <span className="muted small">Уровень</span>
          {[1, 2, 3, 4, 5].map((l) => (
            <button key={l} className={`chip-btn small ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
          <span className="muted small" style={{ marginLeft: 12 }}>
            Отдел
          </span>
          {DIVISIONS.map(([id, label]) => (
            <button
              key={id}
              className={`chip-btn small ${!locators && division === id ? 'active' : ''}`}
              onClick={() => {
                setLocators(false)
                setDivision(id)
              }}
            >
              {label}
            </button>
          ))}
          <button className={`chip-btn small ${locators ? 'active' : ''}`} onClick={() => setLocators(!locators)}>
            Локаторы
          </button>
        </div>
        <div className="calc-form">
          <label className="wide">
            Корпорация или агент
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Caldari Navy…" />
          </label>
          <label className="wide">
            Считать прыжки от
            <SearchBox key={from?.id ?? 0} placeholder="Система…" search={searchSystemsSde} onSelect={setFrom} initial={from?.name ?? ''} />
          </label>
          <label className="check">
            <input type="checkbox" checked={highsec} onChange={(e) => setHighsec(e.target.checked)} /> Только хайсек
          </label>
        </div>
      </Card>
      <Card title={`Агентов: ${agents.data?.total ?? 0}`}>
        {agents.loading && !agents.data ? (
          <Loading />
        ) : !agents.data?.list.length ? (
          <Empty>{agents.error ?? 'Подходящих агентов нет.'}</Empty>
        ) : (
          <table className="table compact">
            <thead>
              <tr>
                <th>Агент</th>
                <th>Корпорация</th>
                <th>Отдел</th>
                <th>Система</th>
                <th className="num">Прыжков</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agents.data.list.map((a) => (
                <tr key={a.id}>
                  <td translate="no">
                    {a.n} <span className="muted small">{`L${a.l}`}</span>
                    {!a.st && <span className="warn-text small"> · в космосе</span>}
                  </td>
                  <td>
                    <img src={imageUrl.corpLogo(a.c, 32)} width={18} height={18} alt="" style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    <span translate="no">{tn(a.corp, lang)}</span>
                  </td>
                  <td className="muted small">{tn(a.div, lang)}</td>
                  <td>
                    <Sec value={a.sec} /> <span translate="no">{a.sys}</span>
                  </td>
                  <td className="num">{a.jumps ?? '—'}</td>
                  <td className="num">
                    <GameButton scope={SCOPE.openWindow} action={(who) => openInfoInGame(who, a.id)} title="Открыть карточку агента в клиенте игры" done="открыто в игре" className="ghost small">
                      Открыть в игре
                    </GameButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(agents.data?.total ?? 0) > LIMIT && <p className="muted small">Показаны 150 ближайших.</p>}
      </Card>
    </>
  )
}
