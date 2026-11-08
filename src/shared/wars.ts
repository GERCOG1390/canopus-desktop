// Wars as ESI gives them: who against whom, where each stands now, and whether they concern this pilot.

export interface WarSide {
  alliance_id?: number
  corporation_id?: number
  isk_destroyed?: number
  ships_killed?: number
}

export interface War {
  id: number
  aggressor: WarSide
  defender: WarSide
  allies?: { alliance_id?: number; corporation_id?: number }[]
  declared: string
  started?: string
  retracted?: string
  finished?: string
  mutual: boolean
  open_for_allies: boolean
}

export type WarStatus = 'pending' | 'active' | 'ending' | 'finished'

/** A side's corporation or alliance. */
export const sideId = (s: { alliance_id?: number; corporation_id?: number }): number => s.alliance_id ?? s.corporation_id ?? 0

/**
 * pending: declared, fighting not started yet (a day's notice). ending: has an end date still ahead, fighting
 * goes on until then, including after a retraction. finished: the end date has passed.
 */
export function warStatus(w: War, now: number): WarStatus {
  if (w.finished && Date.parse(w.finished) <= now) return 'finished'
  if (!w.started || Date.parse(w.started) > now) return 'pending'
  return w.finished ? 'ending' : 'active'
}

export type WarRole = 'aggressor' | 'defender' | 'ally'

/** How this corporation or alliance takes part, if it does. */
export function warRole(w: War, me: { corporationId?: number; allianceId?: number }): WarRole | null {
  const mine = (s: { alliance_id?: number; corporation_id?: number }): boolean =>
    (!!s.corporation_id && s.corporation_id === me.corporationId) || (!!s.alliance_id && s.alliance_id === me.allianceId)
  if (mine(w.aggressor)) return 'aggressor'
  if (mine(w.defender)) return 'defender'
  return (w.allies ?? []).some(mine) ? 'ally' : null
}

/** Mine first, then those that can still be shot in, then by how much has been destroyed, then newest. */
export function sortWars(wars: War[], me: { corporationId?: number; allianceId?: number }, now: number): War[] {
  const rank = (w: War): number => {
    const s = warStatus(w, now)
    return s === 'finished' ? 2 : s === 'pending' ? 1 : 0
  }
  const isk = (w: War): number => (w.aggressor.isk_destroyed ?? 0) + (w.defender.isk_destroyed ?? 0)
  return [...wars].sort(
    (a, b) =>
      Number(!!warRole(b, me)) - Number(!!warRole(a, me)) ||
      rank(a) - rank(b) ||
      isk(b) - isk(a) ||
      b.id - a.id
  )
}

/** What's remembered between sessions: finished wars never change, running ones are read first. */
export interface WarMemory {
  finished: number[]
  running: number[]
  /** Reads lately, to stay well inside the ESI limit shared with killmails */
  spent?: { at: number; count: number }[]
}

const WINDOW_MS = 15 * 60_000
/** Of the 1800 reads ESI allows in its window, the rest stays for kills elsewhere in the app */
const WINDOW_READS = 1200
/** Reads per press */
export const WAR_PORTION = 500

/** How many wars may be read now, and if none, in how many seconds some may. */
export function warBudget(memory: WarMemory, now: number): { budget: number; waitSeconds: number } {
  const recent = (memory.spent ?? []).filter((s) => now - s.at < WINDOW_MS)
  const used = recent.reduce((sum, s) => sum + s.count, 0)
  const budget = Math.min(WAR_PORTION, Math.max(0, WINDOW_READS - used))
  if (budget > 0) return { budget, waitSeconds: 0 }
  const oldest = Math.min(...recent.map((s) => s.at))
  return { budget, waitSeconds: Math.ceil((oldest + WINDOW_MS - now) / 1000) }
}

/** The wars to read now: those known to run, then the unknown ones newest first, up to the budget. */
export function warsToRead(ids: number[], memory: WarMemory, budget: number): { read: number[]; unread: number } {
  const finished = new Set(memory.finished)
  const running = memory.running.filter((id) => !finished.has(id))
  const known = new Set(running)
  const unknown = ids.filter((id) => !finished.has(id) && !known.has(id)).sort((a, b) => b - a)
  const read = [...running, ...unknown].slice(0, budget)
  return { read, unread: running.length + unknown.length - read.length }
}

/** The memory after reading these wars; `requests` is how many were asked for, failed ones included. */
export function rememberWars(memory: WarMemory, read: War[], now: number, requests = read.length): WarMemory {
  const finished = new Set(memory.finished)
  const running = new Set(memory.running)
  for (const w of read) {
    if (warStatus(w, now) === 'finished') {
      finished.add(w.id)
      running.delete(w.id)
    } else {
      running.add(w.id)
    }
  }
  const spent = [...(memory.spent ?? []).filter((s) => now - s.at < WINDOW_MS), { at: now, count: Math.max(requests, read.length) }]
  return { finished: [...finished], running: [...running], spent }
}
