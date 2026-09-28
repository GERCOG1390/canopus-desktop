import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_INTEL } from '../shared/intel'
import { DEFAULT_NOTIFY } from '../shared/notify'
import type { Settings } from '../shared/types'

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')
const tokensPath = (): string => join(app.getPath('userData'), 'tokens.bin')

/**
 * Client ID of the Canopus application registered on developers.eveonline.com
 * (callback eveauthcanopus://callback). Public by design: EVE SSO with PKCE needs no secret.
 */
export const DEFAULT_CLIENT_ID = 'a3159d301b8d450a86f4a95f26e55fd9'

const DEFAULT_SETTINGS: Settings = { clientId: DEFAULT_CLIENT_ID, activeCharacterId: null, alwaysOnTop: false, lang: 'ru', intel: DEFAULT_INTEL, notify: DEFAULT_NOTIFY, autoUpdate: true, theme: 'canopus', density: 'comfortable' }

export function loadSettings(): Settings {
  try {
    if (existsSync(settingsPath())) {
      const saved = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<Settings>
      const intel = { ...DEFAULT_INTEL, ...saved.intel, overlay: { ...DEFAULT_INTEL.overlay, ...saved.intel?.overlay } }
      return { ...DEFAULT_SETTINGS, ...saved, clientId: DEFAULT_CLIENT_ID, intel, notify: { ...DEFAULT_NOTIFY, ...saved.notify } }
    }
  } catch (err) {
    console.error('Failed to read settings, using defaults', err)
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

export interface StoredToken {
  characterId: number
  characterName: string
  scopes: string[]
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
}

/** Tokens are encrypted with the OS keychain (DPAPI on Windows) when available. */
export function loadTokens(): StoredToken[] {
  try {
    if (!existsSync(tokensPath())) return []
    const raw = readFileSync(tokensPath())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
    return JSON.parse(json)
  } catch (err) {
    console.error('Failed to read tokens', err)
    return []
  }
}

export function saveTokens(tokens: StoredToken[]): void {
  const json = JSON.stringify(tokens)
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')
  writeFileSync(tokensPath(), data)
}
