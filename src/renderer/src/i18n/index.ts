// UI translation. The interface is written in Russian; when English is selected every text node
// and a few text attributes are translated on render (see ./jsx-runtime.ts) using ./dict.ts.

import { EXACT, PATTERNS, TOKENS } from './dict'

export type UiLang = 'ru' | 'en'

let current: UiLang = 'ru'
const cache = new Map<string, string>()
const CYRILLIC = /[А-Яа-яЁё]/

export function setUiLang(lang: UiLang): void {
  if (lang !== current) cache.clear()
  current = lang
}

export const uiLang = (): UiLang => current
export const locale = (): string => (current === 'en' ? 'en-US' : 'ru-RU')

function translateCore(text: string): string {
  const exact = EXACT[text]
  if (exact !== undefined) return exact
  for (const [re, replacement] of PATTERNS) {
    const m = re.exec(text)
    if (!m) continue
    // Captured parts may themselves need translating (durations, units, nested phrases).
    return replacement.replace(/\$(\d)/g, (_, i) => translate(m[Number(i)] ?? ''))
  }
  let out = text
  for (const [re, replacement] of TOKENS) out = out.replace(re, replacement)
  return out
}

/** Translates a UI string (Russian → English) when the UI language is English. Keeps surrounding whitespace. */
export function translate(text: string): string {
  if (current === 'ru' || !CYRILLIC.test(text)) return text
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  const lead = /^\s*/.exec(text)![0]
  const trail = /\s*$/.exec(text)![0]
  const core = text.slice(lead.length, text.length - trail.length)
  const result = lead + translateCore(core) + trail
  cache.set(text, result)
  return result
}
