import { useState } from 'react'
import { useLang } from '../../AppContext'
import { useCharacter } from '../../CharacterContext'
import { LevelPips } from '../../components/skills'
import { TypeLink } from '../../components/TypeLink'
import { Card, ErrorBox, Loading, Stat } from '../../components/ui'
import { ATTR_NAMES, spForLevel } from '../../lib/dogma'
import { fmtNum, ROMAN } from '../../lib/format'
import { tn } from '../../lib/sde'
import { useAsync } from '../../lib/useAsync'

type Show = 'trained' | 'all' | 'missing'

export default function Skills() {
  const lang = useLang()
  const char = useCharacter()
  const [filter, setFilter] = useState('')
  const [show, setShow] = useState<Show>('trained')
  const { data, error, loading } = useAsync(() => window.api.sde.skillCatalog(), [])

  if (loading || char.loading) return <Loading />
  if (!data) return <ErrorBox error={error} />

  const skills = char.skills ?? new Map()
  const queued = new Map((char.queue ?? []).map((q) => [q.skill_id, q.finished_level]))
  const f = filter.trim().toLowerCase()
  const allCount = data.reduce((s, g) => s + g.skills.length, 0)
  const lvl5 = [...skills.values()].filter((s) => s.active === 5).length

  return (
    <>
      <div className="stats-row">
        <Stat label="Всего SP" value={fmtNum(char.totalSp)} />
        <Stat label="Изучено навыков" value={`${skills.size} / ${allCount}`} />
        <Stat label="На V уровне" value={lvl5} />
        <Stat label="В очереди" value={queued.size} />
      </div>
      <div className="toolbar">
        <input placeholder="Фильтр навыков (рус/англ)…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="trained">Изученные</option>
          <option value="missing">Не изученные / не до V</option>
          <option value="all">Все навыки</option>
        </select>
        <span className="muted small">Нажмите на навык — откроется полная информация и то, что он открывает.</span>
      </div>
      <div className="grid-cards">
        {data.map((g) => {
          const list = g.skills.filter((s) => {
            const st = skills.get(s.id)
            if (show === 'trained' && !st) return false
            if (show === 'missing' && st?.active === 5) return false
            return !f || s.n[0].toLowerCase().includes(f) || s.n[1].toLowerCase().includes(f)
          })
          if (!list.length) return null
          const sp = g.skills.reduce((a, s) => a + (skills.get(s.id)?.sp ?? 0), 0)
          const maxSp = g.skills.reduce((a, s) => a + spForLevel(s.rank, 5), 0)
          const trainedCount = g.skills.filter((s) => skills.has(s.id)).length
          return (
            <Card
              key={g.id}
              title={tn(g.n, lang)}
              actions={
                <span className="muted small">
                  {trainedCount}/{g.skills.length} · {fmtNum(sp)} / {fmtNum(maxSp)} SP
                </span>
              }
            >
              <ul className="skill-list">
                {list.map((s) => {
                  const st = skills.get(s.id)
                  const q = queued.get(s.id)
                  return (
                    <li key={s.id} className={st ? '' : 'untrained'} title={`Ранг ${s.rank} · ${tn(ATTR_NAMES[s.primary], lang)} / ${tn(ATTR_NAMES[s.secondary], lang)}`}>
                      <TypeLink id={s.id} icon={false} />
                      <span className="skill-meta">
                        {q && <span className="queued">→ {ROMAN[q]}</span>}
                        <span className="muted small">×{s.rank}</span>
                        <LevelPips have={st?.active ?? 0} trained={st?.trained} />
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )
        })}
      </div>
    </>
  )
}
