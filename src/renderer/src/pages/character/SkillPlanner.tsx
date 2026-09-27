// Skill planner: pick goals (fits, ships, modules, skills) and get the queue in training order,
// with the time for the character's attributes, the best remap and +5 implants.

import { useEffect, useMemo, useState } from 'react'
import type { SavedFit } from '../../../../shared/fit'
import { useApp, useLang } from '../../AppContext'
import { useCharacter } from '../../CharacterContext'
import { TypeLink } from '../../components/TypeLink'
import { Card, Empty, SearchBox, Stat } from '../../components/ui'
import { ATTR, ATTR_NAMES, spForLevel, type CharAttributes } from '../../lib/dogma'
import { fmtDuration, ROMAN } from '../../lib/format'
import { useFitting } from '../../lib/fitting'
import { loadGameFits, type GameFitting } from '../../lib/gameFits'
import { CATEGORY, getBasic, primeBasics, searchTypesSde, tn, useTypeBasics } from '../../lib/sde'
import { useAsync } from '../../lib/useAsync'

interface Goal {
  typeId: number
  /** For a skill goal: the level to reach */
  level?: number
  /** Where it came from ("fit Cerberus HAM") */
  label?: string
}

type Step = { skill: number; level: number; rank: number; primary: number; secondary: number }

const ATTRS = [ATTR.CHARISMA, ATTR.INTELLIGENCE, ATTR.MEMORY, ATTR.PERCEPTION, ATTR.WILLPOWER]
/** A new character's attributes (used when nobody is logged in). */
const DEFAULT_BASE: CharAttributes = { 164: 19, 165: 20, 166: 20, 167: 20, 168: 20 }
const GOALS_KEY = 'skill-plan-goals'

/** Every legal remap: each attribute 17–27, 14 points on top of 5 × 17. */
function remaps(): CharAttributes[] {
  const out: CharAttributes[] = []
  for (let a = 0; a <= 10; a++)
    for (let b = 0; b <= 10 && a + b <= 14; b++)
      for (let c = 0; c <= 10 && a + b + c <= 14; c++)
        for (let d = 0; d <= 10 && a + b + c + d <= 14; d++) {
          const e = 14 - a - b - c - d
          if (e > 10) continue
          out.push({ 164: 17 + a, 165: 17 + b, 166: 17 + c, 167: 17 + d, 168: 17 + e })
        }
  return out
}

const planMinutes = (steps: { sp: number; primary: number; secondary: number }[], attrs: CharAttributes) =>
  steps.reduce((t, s) => t + s.sp / ((attrs[s.primary] ?? 0) + (attrs[s.secondary] ?? 0) / 2 || 1), 0)

const withBonus = (base: CharAttributes, bonus: CharAttributes) => Object.fromEntries(ATTRS.map((a) => [a, (base[a] ?? 0) + (bonus[a] ?? 0)])) as CharAttributes

export default function SkillPlanner() {
  const lang = useLang()
  const { active } = useApp()
  const char = useCharacter()
  const { fit } = useFitting()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loaded, setLoaded] = useState(false)
  useTypeBasics(goals.map((g) => g.typeId))

  useEffect(() => {
    void window.api.store.get<Goal[]>(GOALS_KEY).then((g) => {
      setGoals(g ?? [])
      setLoaded(true)
    })
  }, [])
  useEffect(() => {
    if (loaded) void window.api.store.set(GOALS_KEY, goals)
  }, [goals, loaded])

  const saved = useAsync(() => window.api.fit.list(), [])
  const game = useAsync(async () => (active ? await loadGameFits(active.id).catch(() => [] as GameFitting[]) : []), [active?.id])

  const add = (list: Goal[]) => setGoals((g) => [...g, ...list.filter((x) => !g.some((y) => y.typeId === x.typeId && (y.level ?? 0) === (x.level ?? 0)))])
  const fitGoals = (label: string, ship: number, items: number[]): Goal[] => [...new Set([ship, ...items])].map((typeId) => ({ typeId, label }))

  const plan = useAsync(async () => {
    if (!goals.length) return null
    const steps: Step[] = await window.api.sde.skillPlan(goals.map((g) => ({ typeId: g.typeId, level: g.level })))
    primeBasics(await window.api.sde.basics([...new Set(steps.map((s) => s.skill))]))
    return steps
  }, [JSON.stringify(goals.map((g) => [g.typeId, g.level]))])

  // What is left to train, with SP already put into a partially trained level.
  const todo = useMemo(() => {
    return (plan.data ?? [])
      .map((s) => {
        const state = char.skills?.get(s.skill)
        const have = state?.active ?? 0
        if (have >= s.level) return null
        const from = spForLevel(s.rank, s.level - 1)
        const to = spForLevel(s.rank, s.level)
        const done = s.level === have + 1 ? Math.max(0, Math.min(to, state?.sp ?? 0) - from) : 0
        return { ...s, sp: to - from - done }
      })
      .filter((s): s is Step & { sp: number } => !!s)
  }, [plan.data, char.skills])

  const base = char.baseAttributes ?? DEFAULT_BASE
  const implantBonus = char.attributes && char.baseAttributes ? (Object.fromEntries(ATTRS.map((a) => [a, (char.attributes![a] ?? 0) - (char.baseAttributes![a] ?? 0)])) as CharAttributes) : ({} as CharAttributes)
  const plus5 = Object.fromEntries(ATTRS.map((a) => [a, Math.max(implantBonus[a] ?? 0, 5)])) as CharAttributes

  const times = useMemo(() => {
    if (!todo.length) return null
    const now = planMinutes(todo, withBonus(base, implantBonus))
    let best = { attrs: base, min: Infinity }
    for (const r of remaps()) {
      const m = planMinutes(todo, withBonus(r, implantBonus))
      if (m < best.min) best = { attrs: r, min: m }
    }
    return { now, best, implants: planMinutes(todo, withBonus(base, plus5)), both: planMinutes(todo, withBonus(best.attrs, plus5)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo, JSON.stringify(base), JSON.stringify(implantBonus)])

  const rate = (s: Step) => {
    const a = withBonus(base, implantBonus)
    return (a[s.primary] ?? 0) + (a[s.secondary] ?? 0) / 2
  }
  let cumulative = 0
  const skipped = (plan.data?.length ?? 0) - todo.length
  const attrShort = (id: number) => tn(ATTR_NAMES[id], lang).slice(0, 3)

  function copyPlan() {
    const text = todo.map((s) => `${getBasic(s.skill)?.n[0] ?? s.skill} ${s.level}`).join('\n')
    void navigator.clipboard.writeText(text)
  }

  return (
    <>
      <Card title="Цели">
        <div className="plan-sources">
          {fit && (
            <button
              className="ghost"
              onClick={() =>
                add(
                  fitGoals(
                    `Фит «${fit.name}»`,
                    fit.shipTypeId,
                    fit.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]).filter(Boolean).concat(fit.drones.map((d) => d.typeId))
                  )
                )
              }
            >
              {`+ фит из фитинга: ${tn(getBasic(fit.shipTypeId)?.n, lang)}`}
            </button>
          )}
          <select
            value=""
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':')
              if (kind === 's') {
                const f = saved.data?.find((x) => x.id === id) as SavedFit | undefined
                if (f) add(fitGoals(`Фит «${f.name}»`, f.shipTypeId, f.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]).filter(Boolean).concat(f.drones.map((d) => d.typeId))))
              } else if (kind === 'g') {
                const f = game.data?.find((x) => String(x.fitting_id) === id)
                if (f) add(fitGoals(`Фит «${f.name}»`, f.ship_type_id, f.items.map((i) => i.type_id)))
              }
            }}
          >
            <option value="">+ сохранённый фит…</option>
            {!!saved.data?.length && (
              <optgroup label="Сохранённые в Canopus">
                {saved.data.map((f) => (
                  <option key={f.id} value={`s:${f.id}`}>
                    {`${tn(getBasic(f.shipTypeId)?.n, lang)} — ${f.name}`}
                  </option>
                ))}
              </optgroup>
            )}
            {!!game.data?.length && (
              <optgroup label="Фиты из игры">
                {game.data.map((f) => (
                  <option key={f.fitting_id} value={`g:${f.fitting_id}`}>
                    {`${tn(getBasic(f.ship_type_id)?.n, lang)} — ${f.name}`}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <SearchBox
            placeholder="+ корабль, модуль или навык…"
            search={(q) => searchTypesSde(q, lang)}
            onSelect={(t) => add([{ typeId: t.id, level: getBasic(t.id)?.c === CATEGORY.SKILL ? 5 : undefined }])}
            clearOnSelect
          />
        </div>
        {!goals.length ? (
          <p className="muted small">Добавьте, на чём хотите летать или что использовать: фит, корабль, модуль — или навык до нужного уровня.</p>
        ) : (
          <div className="plan-goals">
            {goals.map((g, i) => (
              <span key={`${g.typeId}-${g.level}-${i}`} className="plan-goal">
                <TypeLink id={g.typeId} size={18} />
                {g.level !== undefined && (
                  <select value={g.level} onChange={(e) => setGoals((all) => all.map((x, k) => (k === i ? { ...x, level: Number(e.target.value) } : x)))}>
                    {[1, 2, 3, 4, 5].map((l) => (
                      <option key={l} value={l}>
                        {ROMAN[l]}
                      </option>
                    ))}
                  </select>
                )}
                <button className="ghost small" onClick={() => setGoals((all) => all.filter((_, k) => k !== i))}>
                  ✕
                </button>
              </span>
            ))}
            <button className="ghost small" onClick={() => setGoals([])}>
              Очистить
            </button>
          </div>
        )}
      </Card>

      {goals.length > 0 && (
        <>
          {!todo.length && plan.data ? (
            <Empty>Всё уже изучено — можно летать.</Empty>
          ) : times ? (
            <div className="stats-row">
              <Stat label="Время сейчас" value={fmtDuration(times.now * 60_000)} sub={`${todo.length} уровней${skipped ? ` · уже изучено ${skipped}` : ''}`} />
              <Stat
                label="С лучшим ремапом"
                value={fmtDuration(times.best.min * 60_000)}
                sub={ATTRS.map((a) => `${attrShort(a)} ${times.best.attrs[a]}`).join(' · ')}
              />
              <Stat label="С имплантами +5" value={fmtDuration(times.implants * 60_000)} />
              <Stat label="Ремап + импланты +5" value={fmtDuration(times.both * 60_000)} />
            </div>
          ) : null}
          {todo.length > 0 && (
            <Card
              title="Очередь обучения"
              actions={
                <button className="ghost" onClick={copyPlan} title="Список «Навык Уровень» для импорта плана навыков в игре">
                  Копировать список
                </button>
              }
            >
              <table className="table compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Навык</th>
                    <th>Уровень</th>
                    <th>Атрибуты</th>
                    <th className="num">Время</th>
                    <th className="num">Нарастающим итогом</th>
                  </tr>
                </thead>
                <tbody>
                  {todo.map((s, i) => {
                    const min = s.sp / (rate(s) || 1)
                    cumulative += min
                    return (
                      <tr key={`${s.skill}-${s.level}`}>
                        <td className="muted">{i + 1}</td>
                        <td>
                          <TypeLink id={s.skill} size={18} />
                        </td>
                        <td>{ROMAN[s.level]}</td>
                        <td className="muted small">{`${attrShort(s.primary)} / ${attrShort(s.secondary)}`}</td>
                        <td className="num">{fmtDuration(min * 60_000)}</td>
                        <td className="num muted">{fmtDuration(cumulative * 60_000)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="muted small">
                {char.attributes
                  ? 'Время — по атрибутам и имплантам персонажа (Omega). Ремап перебирает все допустимые распределения атрибутов (17–27, 14 очков сверху).'
                  : 'Персонаж не вошёл: время посчитано по атрибутам нового персонажа без имплантов, все навыки — с нуля.'}
              </p>
            </Card>
          )}
        </>
      )}
    </>
  )
}
