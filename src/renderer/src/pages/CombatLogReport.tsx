// Fights from the game log: what you dealt and took, by weapon and by opponent, misses and weak hits.

import { useEffect, useState } from 'react'
import { Card, Empty, ErrorBox, Loading, Stat } from '../components/ui'
import { fmtDate, fmtDuration, fmtNum } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { findings, type Fight, type Finding, type Side } from '../../../shared/combatReport'

const QUALITY_ORDER = ['Wrecks', 'Smashes', 'Penetrates', 'Hits', 'Glances Off', 'Grazes']

function findingText(f: Finding): string {
  switch (f.code) {
    case 'misses':
      return `${f.weapon}: промахов ${f.percent}%. Проверьте дальность, трекинг и скорость цели.`
    case 'weakHits':
      return `${f.weapon}: слабых попаданий ${f.percent}% (Glances Off и Grazes). Цель слишком быстрая или далеко: нужны веб, пейнт или другая дальность.`
    case 'outdamaged':
      return `Получено больше, чем нанесено: ${fmtNum(f.taken)} против ${fmtNum(f.dealt)}.`
    case 'focus':
      return `${f.who}: ${f.percent}% всего входящего урона. Это первая цель для ответа.`
    case 'tackled':
      return `По вам работал тэкл или РЭБ, разных строк: ${f.lines}.`
  }
}

function SideTables({ s, weaponTitle, partyTitle }: { s: Side; weaponTitle: string; partyTitle: string }) {
  return (
    <>
      <table className="table compact">
        <thead>
          <tr>
            <th>{weaponTitle}</th>
            <th className="num">Урон</th>
            <th className="num">Попаданий</th>
            <th className="num">Промахов</th>
            <th className="num">Точность</th>
            <th className="num">В среднем</th>
            <th className="num">Лучший</th>
            <th>Качество</th>
          </tr>
        </thead>
        <tbody>
          {s.weapons.map((w) => (
            <tr key={w.name}>
              <td>{w.name || '—'}</td>
              <td className="num">{fmtNum(w.damage)}</td>
              <td className="num">{fmtNum(w.hits)}</td>
              <td className="num">{fmtNum(w.misses)}</td>
              <td className="num">{`${Math.round(w.hitRate * 100)}%`}</td>
              <td className="num">{fmtNum(Math.round(w.average))}</td>
              <td className="num">{fmtNum(w.biggest)}</td>
              <td className="muted small">
                {Object.entries(w.quality)
                  .sort((a, b) => QUALITY_ORDER.indexOf(a[0]) - QUALITY_ORDER.indexOf(b[0]))
                  .map(([q, n]) => `${q} ${n}`)
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="table compact">
        <thead>
          <tr>
            <th>{partyTitle}</th>
            <th>Корабль</th>
            <th className="num">Урон</th>
            <th className="num">Попаданий</th>
            <th className="num">Промахов</th>
          </tr>
        </thead>
        <tbody>
          {s.parties.map((p) => (
            <tr key={p.who}>
              <td>{p.who || '—'}</td>
              <td className="muted small">{p.ship ?? ''}</td>
              <td className="num">{fmtNum(p.damage)}</td>
              <td className="num">{fmtNum(p.hits)}</td>
              <td className="num">{fmtNum(p.misses)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function FightView({ f }: { f: Fight }) {
  const notes = findings(f)
  return (
    <>
      <div className="stats-row">
        <Stat label="Нанесено" value={fmtNum(f.dealt.damage)} sub={`${fmtNum(Math.round(f.dealt.dps))} DPS · пик ${fmtNum(Math.round(f.dealt.peakDps))}`} />
        <Stat label="Получено" value={fmtNum(f.taken.damage)} sub={`${fmtNum(Math.round(f.taken.dps))} DPS · пик ${fmtNum(Math.round(f.taken.peakDps))}`} />
        <Stat label="Промахи" value={`${fmtNum(f.dealt.misses)} / ${fmtNum(f.taken.misses)}`} sub="ваши / по вам" />
        <Stat label="Удалённый ремонт" value={fmtNum(f.repairedIn)} sub={`отдано: ${fmtNum(f.repairedOut)}`} />
        <Stat label="Длительность" value={fmtDuration(f.seconds * 1000)} sub={f.capacitor ? `капаситор: ${fmtNum(f.capacitor)} GJ` : undefined} />
      </div>
      {notes.length > 0 && (
        <Card title="Что бросается в глаза">
          {notes.map((n, i) => (
            <p key={i} className="small">
              {findingText(n)}
            </p>
          ))}
        </Card>
      )}
      <Card title="Ваш урон">
        {f.dealt.hits + f.dealt.misses ? <SideTables s={f.dealt} weaponTitle="Оружие" partyTitle="По кому" /> : <p className="muted small">Вы не стреляли.</p>}
      </Card>
      <Card title="Урон по вам">
        {f.taken.hits + f.taken.misses ? <SideTables s={f.taken} weaponTitle="Чем" partyTitle="Кто" /> : <p className="muted small">По вам не стреляли.</p>}
      </Card>
      {f.ewar.length > 0 && (
        <Card title="Тэкл и РЭБ">
          {f.ewar.map((t, i) => (
            <p key={i} className="small">
              {t}
            </p>
          ))}
        </Card>
      )}
      {f.unknown.length > 0 && (
        <Card title={`Не распознано строк: ${f.unknown.length}`}>
          <p className="warn-text small">Эти строки в суммы не вошли. Если их много, покажите их разработчику: формат лога мог отличаться.</p>
          {[...new Set(f.unknown)].slice(0, 15).map((t, i) => (
            <p key={i} className="muted small">
              {t}
            </p>
          ))}
        </Card>
      )}
    </>
  )
}

export default function CombatLogReport() {
  const logs = useAsync(() => window.api.combatReport.logs(), [])
  const [file, setFile] = useState<string | null>(null)
  const [index, setIndex] = useState<number | null>(null)
  useEffect(() => {
    if (!file && logs.data?.length) setFile(logs.data[0].file)
  }, [logs.data, file])
  const fights = useAsync(async () => (file ? window.api.combatReport.fights(file) : null), [file])
  useEffect(() => {
    setIndex(null)
  }, [file])

  const list = fights.data ?? []
  const chosen = index ?? list.length - 1
  const fight = list[chosen]
  return (
    <>
      <Card title="Разбор по логу игры">
        {logs.loading ? (
          <Loading />
        ) : !logs.data?.length ? (
          <p className="muted small">В логах игры этого персонажа пока нет боя. Постреляйте и откройте вкладку снова: лог пишется сразу.</p>
        ) : (
          <div className="calc-form">
            <label className="wide">
              Лог
              <select value={file ?? ''} onChange={(e) => setFile(e.target.value)}>
                {logs.data.map((l) => (
                  <option key={l.file} value={l.file}>
                    {`${fmtDate(new Date(l.modified).toISOString())} · строк боя: ${l.lines}`}
                  </option>
                ))}
              </select>
            </label>
            {list.length > 0 && (
              <label className="wide">
                Бой
                <select value={chosen} onChange={(e) => setIndex(Number(e.target.value))}>
                  {list.map((f, i) => (
                    <option key={f.start} value={i}>
                      {`${new Date(f.start).toISOString().slice(11, 19)} UTC · ${fmtDuration(f.seconds * 1000)} · нанесено ${fmtNum(f.dealt.damage)} · получено ${fmtNum(f.taken.damage)}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </Card>
      {fights.loading ? <Loading /> : fights.error ? <ErrorBox error={fights.error} /> : fight ? <FightView f={fight} /> : logs.data?.length ? <Empty>В этом логе нет боя.</Empty> : null}
      <p className="muted small">
        Всё считается по логу игры на этом компьютере, в сеть ничего не уходит. В логе есть урон уже после резистов и удалённый ремонт. Локального ремонта, состояния щита и брони и типа урона в нём нет, поэтому сколько затанковал фит, из одного лога не узнать. Бой заканчивается после минуты тишины.
      </p>
    </>
  )
}
