// Trial skill levels for the fitting: see a fit as it would be with some skills at another level — a hull
// skill you haven't started, a support skill at IV instead of V — without training anything. The levels
// go into the skill source on top of the character's skills (or of "all V"); the metrics show the
// difference from the real numbers while any are set.

import { useEffect, useState } from 'react'
import type { SkillReq } from '../../../shared/sde'
import { useLang } from '../AppContext'
import { useCharacter } from '../CharacterContext'
import { spPerMinute, trainingMs } from '../lib/dogma'
import { fmtDuration, ROMAN } from '../lib/format'
import { CATEGORY, getBasic, searchTypesSde, tn, useTypeBasics } from '../lib/sde'
import { LevelPips } from './skills'
import { TypeLink } from './TypeLink'
import { SearchBox } from './ui'

export function TrialSkills({
  reqs,
  allV,
  trial,
  onChange
}: {
  /** The fit's required skills (with prerequisites): hull bonuses come from the ship's own. */
  reqs: Record<number, SkillReq>
  /** Fitting with every skill at V (the trial levels then only go down). */
  allV: boolean
  trial: Record<number, number>
  onChange: (t: Record<number, number>) => void
}) {
  const char = useCharacter()
  const lang = useLang()
  const [open, setOpen] = useState(false)
  /** Skills added by search, with what training them needs. */
  const [extra, setExtra] = useState<Record<number, SkillReq>>({})
  const all = { ...reqs, ...extra }
  const ids = Object.keys(all).map(Number)
  useTypeBasics(ids)

  // A skill set in the trial but not in the list (e.g. after the fit changed) stays visible.
  useEffect(() => {
    const missing = Object.keys(trial).map(Number).filter((id) => !all[id])
    if (!missing.length) return
    void window.api.sde.dogmaAttrs(missing, [275, 180, 181]).then((d) =>
      setExtra((e) => ({ ...e, ...Object.fromEntries(missing.map((id) => [id, { level: 1, rank: d[id]?.[275] ?? 1, primary: d[id]?.[180] ?? 0, secondary: d[id]?.[181] ?? 0 }])) }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(trial).join(',')])

  const real = (id: number) => (allV ? 5 : (char.skills?.get(id)?.active ?? 0))
  const level = (id: number) => trial[id] ?? real(id)
  const set = (id: number, l: number) => {
    const next = { ...trial }
    if (l === real(id)) delete next[id]
    else next[id] = l
    onChange(next)
  }
  /** Time to train from the character's skill to the trial level (none when going down). */
  const timeTo = (id: number, l: number) => {
    if (allV || !char.skills || l <= real(id)) return 0
    const r = all[id]
    return trainingMs(r.rank, l, char.skills.get(id)?.sp ?? 0, spPerMinute(char.attributes, r.primary, r.secondary))
  }
  const count = Object.keys(trial).length
  const totalMs = Object.entries(trial).reduce((s, [id, l]) => s + timeTo(Number(id), l), 0)
  const name = (id: number) => tn(getBasic(id)?.n, lang)
  const sorted = ids.sort((a, b) => (trial[b] !== undefined ? 1 : 0) - (trial[a] !== undefined ? 1 : 0) || name(a).localeCompare(name(b)))

  return (
    <div className="trial-skills">
      <div className="trial-head" onClick={() => setOpen(!open)}>
        <span className="mt-caret">{open ? '▾' : '▸'}</span>
        <b>Пробные уровни навыков</b>
        {count > 0 ? (
          <span className="trial-badge">
            {`${count} ${count === 1 ? 'навык' : count < 5 ? 'навыка' : 'навыков'}`}
            {totalMs > 0 && ` · изучить ≈ ${fmtDuration(totalMs)}`}
          </span>
        ) : (
          <span className="muted small">— посмотреть фит с другими уровнями</span>
        )}
      </div>
      {open && (
        <>
          <p className="muted small">
            {allV
              ? 'Расчёт со всеми навыками V: здесь можно понизить отдельные навыки и увидеть, что изменится.'
              : 'Уровни поверх навыков персонажа: поставьте навык, которого у вас ещё нет, на I–V и посмотрите характеристики. Бонусы корпуса дают навыки, требуемые кораблём.'}
          </p>
          <div className="trial-actions">
            <button className="ghost small" onClick={() => onChange(Object.fromEntries(Object.entries(all).map(([id]) => [id, 5]).filter(([id]) => real(Number(id)) < 5)))}>
              Требуемые на V
            </button>
            <button className="ghost small" disabled={!count} onClick={() => onChange({})}>
              Сбросить
            </button>
          </div>
          <div className="trial-search">
            <SearchBox
              placeholder="+ другой навык…"
              search={(q) => searchTypesSde(q, lang, { categories: [CATEGORY.SKILL] })}
              onSelect={(t) => {
                void window.api.sde.dogmaAttrs([t.id], [275, 180, 181]).then((d) =>
                  setExtra((e) => ({ ...e, [t.id]: { level: 1, rank: d[t.id]?.[275] ?? 1, primary: d[t.id]?.[180] ?? 0, secondary: d[t.id]?.[181] ?? 0 } }))
                )
              }}
              clearOnSelect
            />
          </div>
          <div className="trial-list">
            {sorted.map((id) => {
              const l = level(id)
              const changed = trial[id] !== undefined
              const ms = timeTo(id, l)
              return (
                <div key={id} className={`trial-row ${changed ? 'trial-changed' : ''}`}>
                  <div className="trial-name">
                    <TypeLink id={id} size={18} />
                    <span title={allV ? 'Все навыки V' : 'Ваш уровень'}>
                      <LevelPips have={real(id)} need={reqs[id]?.level} />
                    </span>
                  </div>
                  <div className="trial-levels">
                    {[0, 1, 2, 3, 4, 5].map((x) => (
                      <button key={x} className={`chip-btn small ${l === x ? 'active' : ''}`} onClick={() => set(id, x)}>
                        {x === 0 ? '—' : ROMAN[x]}
                      </button>
                    ))}
                    <span className="muted small">
                      {ms > 0 ? `учить ${fmtDuration(ms)}` : changed && l < real(id) ? 'ниже вашего' : reqs[id] ? `нужен ${ROMAN[reqs[id].level]}` : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
