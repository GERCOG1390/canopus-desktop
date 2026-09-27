// Tray and Windows notifications about the characters' timers (skills, PI, industry, fatigue, market, clones).

export interface NotifySettings {
  /** Closing the window hides Canopus to the tray instead of quitting. */
  tray: boolean
  /** Warn when the skill queue ends within this many hours (0 = only when it's empty). */
  skillHours: number
  skills: boolean
  pi: boolean
  industry: boolean
  fatigue: boolean
  orders: boolean
  clone: boolean
}

export const DEFAULT_NOTIFY: NotifySettings = {
  tray: true,
  skillHours: 24,
  skills: true,
  pi: true,
  industry: true,
  fatigue: true,
  orders: true,
  clone: false
}

export type NotifyKind = 'skills' | 'pi' | 'industry' | 'fatigue' | 'orders' | 'clone'

/** A notification that was shown (kept for the history in Settings). */
export interface NotifyEvent {
  at: string
  kind: NotifyKind
  characterId: number
  title: string
  body: string
}
