// Events from the game log for the ratting tracker.

export interface CombatLogEvent {
  /** ms, UTC (EVE time) */
  t: number
  /** Damage you dealt, damage you took, a bounty, or the system you are now in */
  kind: 'out' | 'in' | 'bounty' | 'system'
  /** Damage or ISK */
  amount: number
  /** Target / attacker (English name), or the system name */
  who: string
  weapon?: string
}
