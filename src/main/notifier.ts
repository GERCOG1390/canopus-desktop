// Background checks of every logged-in character's timers, shown as Windows notifications:
// skill queue running out, PI extractors stopped, industry jobs done, jump fatigue over,
// market orders undercut, clone jump available. Each event is announced once.

import { app, Notification } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NotifyEvent, NotifyKind } from '../shared/notify'
import * as auth from './auth'
import { request } from './http'
import { loadSettings } from './storage'
import { postDiscord } from './intel'

const ESI = 'https://esi.evetech.net/latest'
const CHECK_EVERY_MS = 5 * 60_000
const FIRST_CHECK_MS = 30_000
const HISTORY = 50

const seenPath = (): string => join(app.getPath('userData'), 'notified.json')
let seen: Record<string, number> = {}
const history: NotifyEvent[] = []
let timer: NodeJS.Timeout | null = null
let onClick: () => void = () => {}

function loadSeen(): void {
  try {
    if (existsSync(seenPath())) seen = JSON.parse(readFileSync(seenPath(), 'utf8'))
  } catch {
    seen = {}
  }
  // Forget keys older than a month.
  const cutoff = Date.now() - 30 * 86400_000
  for (const [k, t] of Object.entries(seen)) if (t < cutoff) delete seen[k]
}

function saveSeen(): void {
  try {
    writeFileSync(seenPath(), JSON.stringify(seen))
  } catch {
    // best effort
  }
}

const en = (): boolean => loadSettings().lang === 'en'
const t = (ru: string, eng: string): string => (en() ? eng : ru)

function hoursText(ms: number): string {
  const h = Math.max(0, Math.round(ms / 3_600_000))
  if (h < 1) return t('меньше часа', 'less than an hour')
  return en() ? `${h} h` : `${h} ч`
}

/** Shows a notification once per `key`. */
function announce(key: string, kind: NotifyKind, characterId: number, title: string, body: string): boolean {
  if (seen[key]) return false
  seen[key] = Date.now()
  saveSeen()
  history.unshift({ at: new Date().toISOString(), kind, characterId, title, body })
  history.splice(HISTORY)
  if (!Notification.isSupported()) return true
  const n = new Notification({ title, body })
  n.on('click', () => onClick())
  n.show()
  return true
}

const esi = async <T>(path: string, characterId?: number): Promise<T> => (await request(ESI + path, characterId ? { characterId } : {})) as T

async function typeName(id: number): Promise<string> {
  try {
    const r = await esi<{ name: string }>(`/universe/types/${id}/`)
    return r.name
  } catch {
    return String(id)
  }
}

async function checkSkills(id: number, who: string): Promise<void> {
  const queue = await esi<{ finish_date?: string; skill_id: number; finished_level: number }[]>(`/characters/${id}/skillqueue/`, id)
  const end = queue.map((q) => (q.finish_date ? Date.parse(q.finish_date) : 0)).reduce((a, b) => Math.max(a, b), 0)
  const hours = loadSettings().notify.skillHours
  if (!queue.length || end <= Date.now()) {
    announce(`skills-empty-${id}-${new Date().toISOString().slice(0, 10)}`, 'skills', id, t(`${who}: очередь навыков пуста`, `${who}: skill queue is empty`), t('Навыки не изучаются.', 'No skills are training.'))
  } else if (hours > 0 && end - Date.now() < hours * 3_600_000) {
    announce(`skills-ending-${id}-${end}`, 'skills', id, t(`${who}: очередь навыков кончается`, `${who}: skill queue ends soon`), t(`Осталось ${hoursText(end - Date.now())}.`, `${hoursText(end - Date.now())} left.`))
  }
}

async function checkPlanets(id: number, who: string): Promise<void> {
  const planets = await esi<{ planet_id: number; solar_system_id: number; planet_type: string }[]>(`/characters/${id}/planets/`, id)
  for (const p of planets) {
    const detail = await esi<{ pins: { pin_id: number; type_id: number; expiry_time?: string; extractor_details?: unknown }[] }>(`/characters/${id}/planets/${p.planet_id}/`, id)
    const stopped = detail.pins.filter((pin) => pin.extractor_details && pin.expiry_time && Date.parse(pin.expiry_time) <= Date.now())
    for (const pin of stopped) {
      const planet = await esi<{ name: string }>(`/universe/planets/${p.planet_id}/`).catch(() => ({ name: String(p.planet_id) }))
      announce(`pi-${id}-${pin.pin_id}-${pin.expiry_time}`, 'pi', id, t(`${who}: экстрактор остановился`, `${who}: extractor stopped`), planet.name)
    }
  }
}

async function checkIndustry(id: number, who: string): Promise<void> {
  const jobs = await esi<{ job_id: number; status: string; end_date: string; product_type_id?: number; blueprint_type_id: number; activity_id: number }[]>(`/characters/${id}/industry/jobs/`, id)
  for (const j of jobs.filter((x) => x.status === 'active' && Date.parse(x.end_date) <= Date.now())) {
    const name = await typeName(j.product_type_id ?? j.blueprint_type_id)
    announce(`job-${j.job_id}`, 'industry', id, t(`${who}: работа в индустрии готова`, `${who}: industry job ready`), name)
  }
}

async function checkFatigue(id: number, who: string): Promise<void> {
  const f = await esi<{ jump_fatigue_expire_date?: string }>(`/characters/${id}/fatigue/`, id)
  if (!f.jump_fatigue_expire_date) return
  const end = Date.parse(f.jump_fatigue_expire_date)
  if (end <= Date.now() && end > Date.now() - 86400_000) {
    announce(`fatigue-${id}-${end}`, 'fatigue', id, t(`${who}: усталость от прыжков прошла`, `${who}: jump fatigue is over`), t('Можно прыгать без штрафа.', 'You can jump without penalty.'))
  }
}

async function checkClone(id: number, who: string): Promise<void> {
  const c = await esi<{ last_clone_jump_date?: string }>(`/characters/${id}/clones/`, id)
  if (!c.last_clone_jump_date) return
  // Infomorph Synchronizing (skill 33399) cuts the 24 h cooldown by 1 h per level.
  const skills = await esi<{ skills: { skill_id: number; active_skill_level: number }[] }>(`/characters/${id}/skills/`, id).catch(() => ({ skills: [] }))
  const sync = skills.skills.find((s) => s.skill_id === 33399)?.active_skill_level ?? 0
  const ready = Date.parse(c.last_clone_jump_date) + (24 - sync) * 3_600_000
  if (ready <= Date.now() && ready > Date.now() - 86400_000) {
    announce(`clone-${id}-${ready}`, 'clone', id, t(`${who}: доступен прыжок клона`, `${who}: clone jump available`), t('Можно прыгнуть в джамп-клон.', 'You can jump to a jump clone.'))
  }
}

interface CorpStructure {
  structure_id: number
  name?: string
  system_id: number
  state: string
  state_timer_end?: string
  fuel_expires?: string
}

const systemNames = new Map<number, string>()
async function systemName(id: number): Promise<string> {
  if (!systemNames.has(id)) systemNames.set(id, (await esi<{ name: string }>(`/universe/systems/${id}/`).catch(() => ({ name: String(id) }))).name)
  return systemNames.get(id)!
}

/** Corporations whose structures were already checked in this round (several characters, one corp). */
let checkedCorps = new Set<number>()

async function checkStructures(id: number): Promise<void> {
  const cfg = loadSettings()
  if (!auth.characters().find((c) => c.id === id)?.scopes.includes(auth.CORP_SCOPES[0])) return
  const me = await esi<{ corporation_id: number }>(`/characters/${id}/`)
  if (checkedCorps.has(me.corporation_id)) return
  checkedCorps.add(me.corporation_id)
  const list = await esi<CorpStructure[]>(`/corporations/${me.corporation_id}/structures/`, id)
  const discord = cfg.notify.structuresDiscord ? cfg.intel.discord.webhook : ''
  const tell = (key: string, title: string, body: string) => {
    if (announce(key, 'structure', id, title, body) && discord) postDiscord(discord, title, body, 'structure')
  }
  for (const s of list) {
    const name = s.name ?? `#${s.structure_id}`
    const where = await systemName(s.system_id)
    if (s.fuel_expires) {
      const left = Date.parse(s.fuel_expires) - Date.now()
      if (left <= cfg.notify.structureFuelDays * 86400_000) {
        tell(`fuel-${s.structure_id}-${s.fuel_expires}`, t(`${name}: заканчивается топливо`, `${name}: fuel running low`), t(`${where} · осталось ${hoursText(left)}`, `${where} · ${hoursText(left)} left`))
      }
    }
    if (s.state === 'armor_reinforce' || s.state === 'hull_reinforce') {
      const layer = s.state === 'armor_reinforce' ? t('броня', 'armor') : t('корпус', 'hull')
      const until = s.state_timer_end ? ` · ${s.state_timer_end.slice(0, 16).replace('T', ' ')} EVE` : ''
      tell(`rf-${s.structure_id}-${s.state}-${s.state_timer_end}`, t(`${name}: в реинфорсе (${layer})`, `${name}: reinforced (${layer})`), `${where}${until}`)
    }
  }
}

interface CharOrder {
  order_id: number
  type_id: number
  region_id: number
  location_id: number
  price: number
  is_buy_order?: boolean
}
interface MarketOrder {
  order_id: number
  price: number
  location_id: number
  is_buy_order: boolean
}

async function checkOrders(id: number, who: string): Promise<void> {
  const mine = await esi<CharOrder[]>(`/characters/${id}/orders/`, id)
  // One market request per (region, type); a few dozen orders at most per check.
  const byMarket = new Map<string, CharOrder[]>()
  for (const o of mine) {
    const key = `${o.region_id}|${o.type_id}`
    byMarket.set(key, [...(byMarket.get(key) ?? []), o])
  }
  for (const [key, orders] of [...byMarket].slice(0, 40)) {
    const [region, type] = key.split('|')
    const market = ((await request(`${ESI}/markets/${region}/orders/?type_id=${type}&order_type=all`, { allPages: true }).catch(() => [])) as MarketOrder[])
    for (const o of orders) {
      const rivals = market.filter((m) => m.location_id === o.location_id && m.order_id !== o.order_id && m.is_buy_order === !!o.is_buy_order)
      const best = o.is_buy_order ? Math.max(0, ...rivals.map((m) => m.price)) : Math.min(Infinity, ...rivals.map((m) => m.price))
      const undercut = o.is_buy_order ? best > o.price : best < o.price
      if (!undercut) continue
      const name = await typeName(o.type_id)
      const side = o.is_buy_order ? t('покупку', 'buy') : t('продажу', 'sell')
      announce(`order-${o.order_id}-${best}`, 'orders', id, t(`${who}: ваш ордер перебит`, `${who}: your order was undercut`), t(`${name}: ордер на ${side} ${o.price.toLocaleString('ru-RU')} ISK, лучшая цена ${best.toLocaleString('ru-RU')} ISK`, `${name}: ${side} order ${o.price.toLocaleString('en-US')} ISK, best price ${best.toLocaleString('en-US')} ISK`))
    }
  }
}

async function checkAll(): Promise<void> {
  const cfg = loadSettings().notify
  checkedCorps = new Set()
  for (const c of auth.characters()) {
    const run = async (on: boolean, fn: (id: number, who: string) => Promise<void>) => {
      if (!on) return
      try {
        await fn(c.id, c.name)
      } catch {
        // Missing scope or ESI hiccup: try again next time.
      }
    }
    await run(cfg.skills, checkSkills)
    await run(cfg.pi, checkPlanets)
    await run(cfg.industry, checkIndustry)
    await run(cfg.fatigue, checkFatigue)
    await run(cfg.orders, checkOrders)
    await run(cfg.clone, checkClone)
    await run(cfg.structures, checkStructures)
  }
}

export function initNotifier(show: () => void): void {
  onClick = show
  loadSeen()
  setTimeout(() => void checkAll(), FIRST_CHECK_MS)
  timer = setInterval(() => void checkAll(), CHECK_EVERY_MS)
}

export function stopNotifier(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export const notifyHistory = (): NotifyEvent[] => history

/** Run the checks now (from Settings). */
export const checkNow = (): Promise<void> => checkAll()
