import type { SkillReq } from '../../../shared/sde'
import { useCharacter, type CharacterData } from '../CharacterContext'
import { spPerMinute, trainingMs } from '../lib/dogma'
import { fmtDuration, ROMAN } from '../lib/format'
import { TypeLink } from './TypeLink'

export interface MissingSkill {
  skill: number
  have: number
  need: number
  ms: number
}

/** Skills (with levels) the character still lacks, and how long each takes to train. */
export function missingSkills(reqs: Record<number, SkillReq>, char: CharacterData): { list: MissingSkill[]; totalMs: number } {
  const list: MissingSkill[] = []
  let totalMs = 0
  for (const [id, r] of Object.entries(reqs)) {
    const skill = Number(id)
    const state = char.skills?.get(skill)
    const have = state?.active ?? 0
    if (have >= r.level) continue
    const rate = spPerMinute(char.attributes, r.primary, r.secondary)
    const ms = trainingMs(r.rank, r.level, state?.sp ?? 0, rate)
    list.push({ skill, have, need: r.level, ms })
    totalMs += ms
  }
  list.sort((a, b) => a.ms - b.ms)
  return { list, totalMs }
}

/** Five squares like the in-game skill level indicator. */
export function LevelPips({ have, need, trained }: { have: number; need?: number; trained?: number }) {
  return (
    <span className="pips" title={`Уровень ${have}${need ? ` из требуемых ${need}` : ''}`}>
      {[1, 2, 3, 4, 5].map((l) => {
        let cls = ''
        if (l <= have) cls = 'on'
        else if (trained && l <= trained) cls = 'alpha'
        else if (need && l <= need) cls = 'need'
        return <i key={l} className={cls} />
      })}
    </span>
  )
}

export function SkillStatusIcon({ have, need }: { have: number; need: number }) {
  if (have >= need) return <span className="st ok" title="Изучено">✔</span>
  if (have > 0) return <span className="st part" title={`Изучено до ${ROMAN[have]}`}>◐</span>
  return <span className="st no" title="Не изучено">✖</span>
}

/** Summary + list of missing skills for a set of requirements. */
export function MissingSkillsBox({ reqs, title = 'Требования' }: { reqs: Record<number, SkillReq>; title?: string }) {
  const char = useCharacter()
  if (!Object.keys(reqs).length) return null
  if (!char.skills) {
    return <div className="muted small">Войдите персонажем, чтобы сравнить с вашими навыками.</div>
  }
  const { list, totalMs } = missingSkills(reqs, char)
  if (!list.length) return <div className="ok-box">✔ {title}: все навыки изучены</div>
  return (
    <div className="warn-box">
      <div>
        ✖ Не хватает навыков: {list.length} · изучить за <b>{fmtDuration(totalMs)}</b>
      </div>
      <ul className="missing">
        {list.map((m) => (
          <li key={m.skill}>
            <TypeLink id={m.skill} icon={false} /> <b>{ROMAN[m.need]}</b>
            <span className="muted"> (сейчас {m.have ? ROMAN[m.have] : 'нет'}) · {fmtDuration(m.ms)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
