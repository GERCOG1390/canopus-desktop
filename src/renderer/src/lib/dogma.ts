import type { L10n } from '../../../shared/sde'
import { locale } from '../i18n'

// ---------- Character attributes & skill training ----------

export const ATTR = {
  CHARISMA: 164,
  INTELLIGENCE: 165,
  MEMORY: 166,
  PERCEPTION: 167,
  WILLPOWER: 168
} as const

/** Implant dogma attributes that add to each character attribute. */
export const IMPLANT_BONUS: Record<number, number> = { 164: 175, 165: 176, 166: 177, 167: 178, 168: 179 }
export const IMPLANT_SLOT_ATTR = 331

export const ATTR_NAMES: Record<number, L10n> = {
  164: ['Charisma', 'Харизма'],
  165: ['Intelligence', 'Интеллект'],
  166: ['Memory', 'Память'],
  167: ['Perception', 'Восприятие'],
  168: ['Willpower', 'Сила воли']
}

export type CharAttributes = Record<number, number>

/** Skill points needed to reach `level` for a skill of the given rank. */
export function spForLevel(rank: number, level: number): number {
  if (level <= 0) return 0
  return Math.ceil(250 * rank * Math.pow(2, 2.5 * (level - 1)))
}

/** Omega training speed in SP per minute. */
export function spPerMinute(attrs: CharAttributes | null, primary: number, secondary: number): number {
  if (!attrs) return 0
  return (attrs[primary] ?? 0) + (attrs[secondary] ?? 0) / 2
}

/** Milliseconds to train from `currentSp` to `level`. */
export function trainingMs(rank: number, level: number, currentSp: number, rate: number): number {
  if (!rate) return 0
  const need = Math.max(0, spForLevel(rank, level) - currentSp)
  return (need / rate) * 60_000
}

// ---------- Dogma attribute display ----------

export const SIZE_CLASS: Record<number, [string, string]> = {
  1: ['Small', 'Малый'],
  2: ['Medium', 'Средний'],
  3: ['Large', 'Большой'],
  4: ['X-Large', 'Сверхбольшой']
}

const num = (v: number, max = 2): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: Math.abs(v) < 1 && v !== 0 ? 4 : max }).format(v)

/**
 * Formats a raw dogma value according to its unit, like the in-game Show Info window.
 * Units that point at other objects (typeID, groupID, attributeID) are handled by the caller.
 */
export function formatValue(value: number, unit: number | undefined, unitName: string): string {
  switch (unit) {
    case 101: // milliseconds
      return `${num(value / 1000)} с`
    case 108: // inverse absolute percent (resonances)
      return `${num((1 - value) * 100)} %`
    case 109: // modifier percent
      return `${value >= 1 ? '+' : ''}${num((value - 1) * 100)} %`
    case 111: // inversed modifier percent
      return `${num((1 - value) * 100)} %`
    case 127: // absolute percent
      return `${num(value * 100)} %`
    case 104:
      return `${num(value)}x`
    case 137:
      return value ? 'Да' : 'Нет'
    case 139:
      return `${value > 0 ? '+' : ''}${num(value)}`
    case 140:
      return `Уровень ${num(value)}`
    case 117:
      return SIZE_CLASS[value]?.[1] ?? String(value)
    case 142:
      return ({ 1: 'Мужской', 2: 'Любой', 3: 'Женский' } as Record<number, string>)[value] ?? String(value)
    case 1:
      return value >= 10_000 ? `${num(value / 1000)} км` : `${num(value)} м`
    default:
      return `${num(value)}${unitName ? ' ' + unitName : ''}`
  }
}

export const CATEGORY_RU: Record<string, string> = {
  Fitting: 'Оснащение',
  Shield: 'Щиты',
  Armor: 'Броня',
  Structure: 'Корпус',
  Capacitor: 'Накопитель',
  Targeting: 'Захват целей',
  Miscellaneous: 'Прочее',
  'Required Skills': 'Требуемые навыки',
  'Speed and Travel': 'Скорость и перемещение',
  'EW - Resistance': 'РЭБ: сопротивляемость',
  'EW - Target Painting': 'РЭБ: подсветка цели',
  'EW - Energy Neutralizing': 'РЭБ: нейтрализация',
  'EW - Remote Electronic Counter Measures': 'РЭБ: подавление захвата',
  'EW - Remote Sensor Dampening': 'РЭБ: демпфирование сенсоров',
  'EW - Tracking Disruption': 'РЭБ: срыв наводки',
  'EW - Stasis Webbing': 'РЭБ: стазис-сети',
  'EW - Warp Scrambling': 'РЭБ: блокировка варпа',
  'Electronic Resistances': 'Сопротивляемость РЭБ',
  Drones: 'Дроны',
  Fighter: 'Истребители',
  'Fighter Abilities': 'Способности истребителей',
  AI: 'ИИ',
  Loot: 'Добыча',
  Graphics: 'Графика',
  Other: 'Прочее',
  Turret: 'Турель',
  Missile: 'Ракеты',
  NULL: 'Прочее',
  'Bonuses': 'Бонусы',
  'Special Structure Attributes': 'Особые атрибуты структур'
}

export const ACTIVITY_RU: Record<string, string> = {
  manufacturing: 'Производство',
  reaction: 'Реакция',
  invention: 'Изобретение',
  copying: 'Копирование',
  research_material: 'Исследование ME',
  research_time: 'Исследование TE'
}
