import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useApp } from './AppContext'
import { ATTR, IMPLANT_BONUS, type CharAttributes } from './lib/dogma'
import { esi } from './lib/esi'

export interface SkillState {
  active: number
  trained: number
  sp: number
}

export interface QueueEntry {
  skill_id: number
  finished_level: number
  queue_position: number
  start_date?: string
  finish_date?: string
  level_start_sp?: number
  level_end_sp?: number
  training_start_sp?: number
}

interface EsiAttributes {
  charisma: number
  intelligence: number
  memory: number
  perception: number
  willpower: number
  bonus_remaps?: number
  last_remap_date?: string
  accrued_remap_cooldown_date?: string
}

export interface CharacterData {
  characterId: number | null
  skills: Map<number, SkillState> | null
  totalSp: number
  unallocatedSp: number
  queue: QueueEntry[] | null
  /** Base attributes from ESI (without implants). */
  baseAttributes: CharAttributes | null
  /** Base + implant bonuses — what training speed is computed from. */
  attributes: CharAttributes | null
  remap: Pick<EsiAttributes, 'bonus_remaps' | 'last_remap_date' | 'accrued_remap_cooldown_date'> | null
  implants: number[] | null
  loading: boolean
  reload: () => void
  /** Current trained level (0 if unknown/not trained). */
  level: (skillId: number) => number
}

const Ctx = createContext<CharacterData | null>(null)

const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

/** Actual training speed (SP/min) of the skill currently in training, from the queue timestamps. */
function observedRate(queue: QueueEntry[] | null): { skill: number; rate: number } | null {
  const now = Date.now()
  const e = queue?.find((q) => q.start_date && q.finish_date && new Date(q.finish_date).getTime() > now)
  if (!e?.start_date || !e.finish_date || e.level_end_sp === undefined || e.training_start_sp === undefined) return null
  const minutes = (new Date(e.finish_date).getTime() - new Date(e.start_date).getTime()) / 60_000
  if (minutes <= 0) return null
  return { skill: e.skill_id, rate: (e.level_end_sp - e.training_start_sp) / minutes }
}

export function CharacterProvider({ children }: { children: ReactNode }) {
  const { active } = useApp()
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<Omit<CharacterData, 'reload' | 'level'>>({
    characterId: null,
    skills: null,
    totalSp: 0,
    unallocatedSp: 0,
    queue: null,
    baseAttributes: null,
    attributes: null,
    remap: null,
    implants: null,
    loading: false
  })

  useEffect(() => {
    if (!active) {
      setState((s) => ({ ...s, characterId: null, skills: null, queue: null, attributes: null, baseAttributes: null, implants: null, loading: false }))
      return
    }
    let cancelled = false
    const id = active.id
    setState((s) => ({ ...s, loading: true }))
    ;(async () => {
      const auth = { characterId: id }
      const [skills, queue, attrs, implants] = await Promise.all([
        settle(esi<{ skills: { skill_id: number; active_skill_level: number; trained_skill_level: number; skillpoints_in_skill: number }[]; total_sp: number; unallocated_sp?: number }>(`/characters/${id}/skills/`, auth)),
        settle(esi<QueueEntry[]>(`/characters/${id}/skillqueue/`, auth)),
        settle(esi<EsiAttributes>(`/characters/${id}/attributes/`, auth)),
        settle(esi<number[]>(`/characters/${id}/implants/`, auth))
      ])
      const base: CharAttributes | null = attrs
        ? { [ATTR.CHARISMA]: attrs.charisma, [ATTR.INTELLIGENCE]: attrs.intelligence, [ATTR.MEMORY]: attrs.memory, [ATTR.PERCEPTION]: attrs.perception, [ATTR.WILLPOWER]: attrs.willpower }
        : null
      let effective = base
      if (base && implants?.length) {
        const bonuses = await window.api.sde.dogmaAttrs(implants, Object.values(IMPLANT_BONUS)).catch(() => ({}) as Record<number, Record<number, number>>)
        const withImplants = { ...base }
        for (const imp of implants) {
          for (const [attr, bonusAttr] of Object.entries(IMPLANT_BONUS)) withImplants[Number(attr)] += bonuses[imp]?.[bonusAttr] ?? 0
        }
        effective = withImplants
        // Whether ESI's numbers already include implants isn't documented; the skill in training
        // tells us: pick whichever attribute set reproduces its real SP/min.
        const observed = observedRate(queue)
        if (observed) {
          const [primary, secondary] = await window.api.sde
            .dogmaAttrs([observed.skill], [180, 181])
            .then((d) => [d[observed.skill][180], d[observed.skill][181]])
          const rate = (a: CharAttributes) => (a[primary] ?? 0) + (a[secondary] ?? 0) / 2
          if (Math.abs(rate(base) - observed.rate) < Math.abs(rate(withImplants) - observed.rate)) effective = base
        }
      }
      if (cancelled) return
      setState({
        characterId: id,
        skills: skills ? new Map(skills.skills.map((s) => [s.skill_id, { active: s.active_skill_level, trained: s.trained_skill_level, sp: s.skillpoints_in_skill }])) : null,
        totalSp: skills?.total_sp ?? 0,
        unallocatedSp: skills?.unallocated_sp ?? 0,
        queue: queue ? [...queue].sort((a, b) => a.queue_position - b.queue_position) : null,
        baseAttributes: base,
        attributes: effective,
        remap: attrs ? { bonus_remaps: attrs.bonus_remaps, last_remap_date: attrs.last_remap_date, accrued_remap_cooldown_date: attrs.accrued_remap_cooldown_date } : null,
        implants,
        loading: false
      })
    })()
    return () => {
      cancelled = true
    }
  }, [active?.id, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const level = useCallback((skillId: number) => state.skills?.get(skillId)?.active ?? 0, [state.skills])

  return <Ctx.Provider value={{ ...state, reload, level }}>{children}</Ctx.Provider>
}

export function useCharacter(): CharacterData {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCharacter outside CharacterProvider')
  return ctx
}
