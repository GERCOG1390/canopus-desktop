// What changed between two runs of the simulator: the one the pilot pinned as the baseline and the current one.
// The simulator shows these next to the verdict ("killed 17 s sooner", "you keep 22%, was 0"), so a change to
// heat, ammo or orders is judged at a glance instead of by remembering the last numbers.
//
// Also the undo history of the simulator's setup.

type Winner = 'a' | 'b' | 'both' | null

interface HpOf {
  hp: { shield: number; armor: number; hull: number }
}
interface SideOf {
  left: { s: number; a: number; h: number }
  averageDps: number
  heat?: { modules: { burnt: number | null }[] }
}
/** The part of a CombatResult the comparison reads. */
export interface FightLike {
  a: HpOf
  b: HpOf
  timeline: { winner: Winner; end: number; a: SideOf; b: SideOf }
}

export interface FightSummary {
  winner: Winner
  /** When the fight ended (a kill, or the time limit). */
  end: number
  /** Share of each ship left at the end, 0–100, hit points weighed by layer (as the verdict counts it). */
  leftA: number
  leftB: number
  /** Your modules burnt out by overheating. */
  burntA: number
  /** Your average damage per second over the fight, after resists. */
  dpsA: number
}

const share = (side: HpOf, left: SideOf['left']): number => {
  const total = side.hp.shield + side.hp.armor + side.hp.hull
  return total ? Math.round(((left.s * side.hp.shield + left.a * side.hp.armor + left.h * side.hp.hull) / total) * 100) : 0
}

export function summarize(r: FightLike): FightSummary {
  const tl = r.timeline
  return {
    winner: tl.winner,
    end: tl.end,
    leftA: share(r.a, tl.a.left),
    leftB: share(r.b, tl.b.left),
    burntA: tl.a.heat?.modules.filter((m) => m.burnt !== null).length ?? 0,
    dpsA: tl.a.averageDps
  }
}

export type Change =
  /** Who wins changed. */
  | { kind: 'result'; now: Winner; base: Winner; better: boolean }
  /** You kill the opponent in both runs, sooner or later by `seconds`. */
  | { kind: 'kill'; seconds: number; better: boolean }
  /** You die in both runs, sooner or later by `seconds`. */
  | { kind: 'survive'; seconds: number; better: boolean }
  /** What is left of your ship at the end. */
  | { kind: 'left'; now: number; base: number; better: boolean }
  /** What is left of the opponent when nobody dies. */
  | { kind: 'leftThem'; now: number; base: number; better: boolean }
  /** Your modules burnt out. */
  | { kind: 'burnt'; now: number; base: number; better: boolean }
  /** Your average damage, by percent. */
  | { kind: 'dps'; pct: number; better: boolean }

/** Best for you first: you win, nobody dies, both die, you die. */
const RANK: Record<string, number> = { a: 3, null: 2, both: 1, b: 0 }
const youKill = (w: Winner) => w === 'a' || w === 'both'
const youDie = (w: Winner) => w === 'b' || w === 'both'

/** The differences that matter, most important first; empty when the two runs end the same way. */
export function compareFights(base: FightSummary, now: FightSummary): Change[] {
  const out: Change[] = []
  if (base.winner !== now.winner) out.push({ kind: 'result', now: now.winner, base: base.winner, better: RANK[String(now.winner)] > RANK[String(base.winner)] })
  if (youKill(base.winner) && youKill(now.winner) && Math.abs(now.end - base.end) >= 0.5) {
    out.push({ kind: 'kill', seconds: Math.abs(now.end - base.end), better: now.end < base.end })
  }
  if (youDie(base.winner) && youDie(now.winner) && !youKill(now.winner) && Math.abs(now.end - base.end) >= 0.5) {
    out.push({ kind: 'survive', seconds: Math.abs(now.end - base.end), better: now.end > base.end })
  }
  if (!youDie(now.winner) && now.leftA !== base.leftA) out.push({ kind: 'left', now: now.leftA, base: base.leftA, better: now.leftA > base.leftA })
  if (now.winner === null && base.winner === null && now.leftB !== base.leftB) out.push({ kind: 'leftThem', now: now.leftB, base: base.leftB, better: now.leftB < base.leftB })
  if (now.burntA !== base.burntA) out.push({ kind: 'burnt', now: now.burntA, base: base.burntA, better: now.burntA < base.burntA })
  if (base.dpsA > 0) {
    const pct = Math.round(((now.dpsA - base.dpsA) / base.dpsA) * 100)
    if (Math.abs(pct) >= 1) out.push({ kind: 'dps', pct, better: pct > 0 })
  }
  return out
}

/**
 * What to say about a change rated better (`up`) or worse overall: the most important difference that agrees with
 * the rating, and before it the more important one that points the other way, if any ("kills sooner, but less is
 * left"), so the words never contradict the colour.
 */
export function explainChange(changes: Change[], up: boolean): Change[] {
  const agree = changes.findIndex((c) => c.better === up)
  if (agree < 0) return changes.slice(0, 1)
  const against = changes.findIndex((c) => c.better !== up)
  return against >= 0 && against < agree ? [changes[against], changes[agree]] : [changes[agree]]
}

// ---------- undo history ----------

export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export const historyStart = <T>(present: T): History<T> => ({ past: [], present, future: [] })

/** A new state: becomes the present, the old one goes to the past, redo is gone. A state equal to the present is no change. */
export function historyPush<T>(h: History<T>, next: T, same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b), limit = 100): History<T> {
  if (same(h.present, next)) return h
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] }
}

export function historyUndo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function historyRedo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}
