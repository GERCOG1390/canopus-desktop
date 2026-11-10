// Small rules about a character that ESI leaves to the reader.

interface Queued {
  skill_id: number
  start_date?: string
  finish_date?: string
  level_end_sp?: number
  level_start_sp?: number
  training_start_sp?: number
}

/**
 * SP in a skill right now. ESI's skill list holds them as they were when training started; the queue says how far
 * the current level has gone since.
 */
export function accruedSp(skill: number, sp: number, queue: Queued[] | null | undefined, now: number): number {
  const q = queue?.find((e) => e.skill_id === skill && e.start_date && e.finish_date && Date.parse(e.start_date) <= now && Date.parse(e.finish_date) > now)
  if (!q || q.level_end_sp === undefined) return sp
  const start = q.training_start_sp ?? q.level_start_sp ?? sp
  const from = Date.parse(q.start_date as string)
  const share = (now - from) / (Date.parse(q.finish_date as string) - from)
  return Math.max(sp, Math.round(start + (q.level_end_sp - start) * share))
}

/** The interface language for a first start: Russian on a Russian system, English elsewhere. */
export const langFor = (locale: string | undefined): 'ru' | 'en' => (locale?.toLowerCase().startsWith('ru') ? 'ru' : 'en')
