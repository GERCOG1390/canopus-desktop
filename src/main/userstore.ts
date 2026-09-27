// Small JSON documents the renderer keeps across restarts (abyss runs, skill plans…), one file per key
// in the profile folder.

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = (): string => join(app.getPath('userData'), 'store')
const safeKey = (key: string): string => key.replace(/[^a-z0-9_-]/gi, '_')

export function storeGet(key: string): unknown {
  const file = join(dir(), `${safeKey(key)}.json`)
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  } catch {
    return null
  }
}

export function storeSet(key: string, value: unknown): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(join(dir(), `${safeKey(key)}.json`), JSON.stringify(value))
}
