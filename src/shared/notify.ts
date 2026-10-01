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
  /** Corporation structures: fuel running low, armor / hull reinforced */
  structures: boolean
  /** Warn when a structure has this many days of fuel left or less */
  structureFuelDays: number
  /** Also post structure alerts to the intel Discord webhook */
  structuresDiscord: boolean
}

export const DEFAULT_NOTIFY: NotifySettings = {
  tray: true,
  skillHours: 24,
  skills: true,
  pi: true,
  industry: true,
  fatigue: true,
  orders: true,
  clone: false,
  structures: true,
  structureFuelDays: 3,
  structuresDiscord: true
}

export type NotifyKind = 'skills' | 'pi' | 'industry' | 'fatigue' | 'orders' | 'clone' | 'structure'

/** A notification that was shown (kept for the history in Settings). */
export interface NotifyEvent {
  at: string
  kind: NotifyKind
  characterId: number
  title: string
  body: string
}
