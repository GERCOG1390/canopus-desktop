import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '../shared/types'

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')
const tokensPath = (): string => join(app.getPath('userData'), 'tokens.bin')

const DEFAULT_SETTINGS: Settings = { clientId: '', activeCharacterId: null, alwaysOnTop: false, lang: 'ru' }

export function loadSettings(): Settings {
  try {
    if (existsSync(settingsPath())) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsPath(), 'utf8')) }
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
