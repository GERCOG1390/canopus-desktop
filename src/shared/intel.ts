// Local/D-scan intel: types shared by the log & clipboard watchers, the scan UI and the overlay.

export interface IntelSettings {
  /** Folder with EVE chat logs; empty = auto-detect (Documents\EVE\logs\Chatlogs). */
  logDir: string
  /** Scan automatically when a local list / D-scan / fleet window is copied (Ctrl+A, Ctrl+C in game). */
  clipboard: boolean
  /** Also scan pilots who speak in Local. */
  scanSpeakers: boolean
  /** Notify when pilots at or above this threat level enter local. */
  alertLevel: 'off' | 'hostile' | 'high' | 'medium'
  sound: boolean
  overlay: {
    enabled: boolean
    opacity: number
    clickThrough: boolean
    bounds?: { x: number; y: number; width: number; height: number }
  }
}

export const DEFAULT_INTEL: IntelSettings = {
  logDir: '',
  clipboard: true,
  scanSpeakers: true,
  alertLevel: 'high',
  sound: true,
  overlay: { enabled: false, opacity: 0.85, clickThrough: false }
}

export type ClipboardKind = 'local' | 'dscan' | 'fleet'

export interface ClipboardEvent {
  kind: ClipboardKind
  text: string
}

export type LogEvent =
  | { type: 'system'; system: string; at: string; initial: boolean }
  | { type: 'speaker'; name: string; at: string; initial: boolean }
  | { type: 'status'; file: string | null; dir: string | null; error?: string }

export type Threat = 'hostile' | 'high' | 'medium' | 'low' | 'friendly' | 'unknown'

export interface OverlayPilot {
  id: number
  name: string
  ticker: string
  threat: Threat
  shipTypeId?: number
  isNew: boolean
}

/** Compact state the main window publishes for the overlay. */
export interface OverlaySummary {
  system: string | null
  security: number | null
  scannedAt: string | null
  stale: boolean
  total: number
  counts: Record<Threat, number>
  pilots: OverlayPilot[]
  left: number
}
