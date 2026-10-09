// Streamer mode: widgets for OBS (Browser source) served by Canopus on 127.0.0.1.

export interface StreamSettings {
  enabled: boolean
  port: number
  /** Whose data the widgets show; null = the active character */
  characterId: number | null
  /** Show the current system this many minutes late, against stream sniping; -1 = never show it */
  locationDelayMin: number
  /** Show the session's wallet change */
  showWallet: boolean
}

export const DEFAULT_STREAM: StreamSettings = { enabled: false, port: 7810, characterId: null, locationDelayMin: 5, showWallet: true }

export const STREAM_WIDGETS = ['ship', 'system', 'session', 'killfeed'] as const
export type StreamWidget = (typeof STREAM_WIDGETS)[number]

export interface StreamKill {
  id: number
  at: string
  loss: boolean
  shipTypeId: number
  shipName: string
  /** Victim of a kill, or the final blow of a loss */
  other: string
  isk: number
}

/** What the widgets read from /api/state. */
export interface StreamState {
  character: { id: number; name: string } | null
  ship: { typeId: number; typeName: string; name: string } | null
  /** null when hidden (delay "never") or not known yet */
  system: { name: string; security: number; region: string } | null
  /** Minutes the shown system lags behind, when delayed */
  delayMin: number
  session: { startedAt: string; walletChange: number | null; kills: number; losses: number; iskDestroyed: number; iskLost: number }
  killfeed: StreamKill[]
  updatedAt: string
}

export interface StreamStatus {
  running: boolean
  url: string | null
  error: string | null
}
