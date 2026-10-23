// Tools the assistant can call: everything Canopus knows (characters, skills, fits, the dogma engine,
// SDE, market, routes, intel) and the app actions it may take (open a page, load a fit). The model gets
// numbers computed here instead of guessing them; actions in the game itself ask the user first.

import type { ToolDef } from '../../../shared/assistant'
import type { CombatPilot } from '../../../shared/combat'
import type { FitSpec, FitStats, SkillSource } from '../../../shared/fit'
import type { CharacterAuth } from '../../../shared/types'
import type { PageId } from '../AppContext'
import type { CharacterData } from '../CharacterContext'
import { esi, resolveLocations } from './esi'
import { fromEft, toEft } from './fitting'
import { loadGameFits } from './gameFits'
import { HUBS, hubPrices } from './market'
import { systemDanger } from './routeSafety'
import { getBasic, primeBasics } from './sde'
import { findCheaper, findUpgrades, loadVariants, METRICS, sideEffects, swap, type Metric } from '../pages/FitOptimize'
import { fromEsiItems } from './fitting'
import { loadRow } from '../pages/character/AllCharacters'
import { profitByItem, transactions, type Journal, type Tx } from '../pages/Trades'
import { saveFitToGame, setDestinationInGame, SCOPE, hasScope } from './gameActions'
import { spForLevel } from './dogma'
import { roundSec } from './format'
import { jitaPrices } from './market'
import { NPC_FACTIONS, type NpcFaction, type NpcReport } from '../../../shared/npc'

/** The fit on the ship the character is flying now: its assets inside the active ship, slot by slot. */
async function currentShipFit(c: CharacterAuth, skills: SkillSource): Promise<FitSpec> {
  const ship = await esi<{ ship_item_id: number; ship_type_id: number; ship_name: string }>(`/characters/${c.id}/ship/`, { characterId: c.id })
  const assets = await esi<{ item_id: number; type_id: number; location_id: number; quantity: number; location_flag: string }[]>(`/characters/${c.id}/assets/`, {
    characterId: c.id,
    allPages: true
  })
  const inside = assets.filter((a) => a.location_id === ship.ship_item_id)
  const fit = await fromEsiItems(
    ship.ship_type_id,
    ship.ship_name || 'Current ship',
    inside.map((a) => ({ typeId: a.type_id, flag: a.location_flag, qty: a.quantity }))
  )
  return launchDrones(fit, skills)
}

const fmtTtk = (s: number) => (Number.isFinite(s) ? Math.round(s) : 'never')

function npcSummary(r: NpcReport) {
  return {
    faction: r.faction,
    paper_dps: r.paperDps && Math.round(r.paperDps),
    per_class: r.classes.map((c) => ({
      class: c.cls,
      applied_share: `${Math.round(c.application * 100)}%`,
      applied_dps: Math.round(c.appliedDps),
      ttk_s_median: fmtTtk(c.ttkMedian),
      range_s: `${fmtTtk(c.fastest.ttk)}–${fmtTtk(c.slowest.ttk)}`,
      ...(c.unkillable ? { unkillable: c.unkillable } : {}),
      ...(c.approach ? { must_approach: true } : {}),
      ...(c.limits.length ? { limited_by: c.limits } : {}),
      npc: `hp ${Math.round(c.typical.hp)}, sig ${Math.round(c.typical.sig)} m, ${Math.round(c.typical.speed)} m/s, orbit ${r1(c.typical.orbit / 1000)} km`
    })),
    weapon_reach_km: r1(r.weaponReach / 1000),
    typical_room: { ...r.room.composition, clear_s: fmtTtk(r.room.seconds) },
    note: r.note
  }
}

/** Security as the game shows it (0.45 is 0.5, high-sec). */
const sec = (v: number) => roundSec(v)

export interface ToolContext {
  active: CharacterAuth | null
  characters: CharacterAuth[]
  page: PageId
  lang: 'ru' | 'en'
  char: CharacterData
  fit: FitSpec | null
  navigate: (page: PageId, arg?: number | null) => void
  openFit: (fit: FitSpec) => void
  /** The fit that was open before the assistant opened another one (the chat offers to bring it back) */
  replaced?: (previous: FitSpec) => void
}

const PAGES: PageId[] = ['character', 'mail', 'fleet', 'intel', 'fitting', 'pvp', 'market', 'industry', 'map', 'activities', 'stream', 'settings']

const r1 = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`

async function names(ids: number[]): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => id && !getBasic(id))
  if (missing.length) primeBasics(await window.api.sde.basics(missing))
}
const en = (id: number) => getBasic(id)?.n[0] ?? `#${id}`

/** An item by exact name (either language), else the best search match. */
async function findType(name: string): Promise<number | null> {
  const key = name.trim().toLowerCase()
  if (/^\d+$/.test(key)) return Number(key)
  const hits = await window.api.sde.search(name, { limit: 10 })
  return (hits.find((h) => h.n.some((n) => n.toLowerCase() === key)) ?? hits[0])?.id ?? null
}

async function findSystem(name: string): Promise<{ id: number; n: string; sec: number } | null> {
  const key = name.trim().toLowerCase()
  const hits = await window.api.sde.searchSystems(name, 10)
  return hits.find((h) => h.n.toLowerCase() === key) ?? hits[0] ?? null
}

function who(ctx: ToolContext, name?: string): CharacterAuth {
  const c = name ? ctx.characters.find((x) => x.name.toLowerCase() === name.toLowerCase()) : ctx.active
  if (!c) throw new Error(name ? `Персонаж «${name}» не вошёл в Canopus` : 'Нет активного персонажа: войдите через EVE SSO')
  return c
}

function skillsFor(ctx: ToolContext, mode?: string): SkillSource {
  if (mode !== 'all5' && ctx.char.skills) return { mode: 'char', levels: Object.fromEntries([...ctx.char.skills.entries()].map(([id, s]) => [id, s.active])) }
  return { mode: 'all5' }
}

async function parseFit(eft: string | undefined, ctx: ToolContext): Promise<FitSpec> {
  if (!eft?.trim()) {
    if (!ctx.fit) throw new Error('Фит не указан, и в фитинге Canopus ничего не открыто')
    return ctx.fit
  }
  const { fit, unknown } = await fromEft(eft)
  if (unknown.length) throw new Error(`Неизвестные предметы в фите: ${unknown.join(', ')}. Проверьте точные английские названия (search_items).`)
  return launchDrones(fit, skillsFor(ctx))
}

/** Launches drones the way a pilot would: in order, as many as the hull's drone limit and bandwidth allow. */
async function launchDrones(fit: FitSpec, skills: SkillSource): Promise<FitSpec> {
  if (!fit.drones.length) return fit
  const idle = { ...fit, drones: fit.drones.map((d) => ({ ...d, active: 0 })) }
  const [stats, bw] = await Promise.all([window.api.fit.calculate(idle, skills), window.api.sde.dogmaAttrs(fit.drones.map((d) => d.typeId), [1272])])
  let slots = stats.ship.maxActiveDrones
  let band = stats.ship.droneBandwidth.total
  const drones = idle.drones.map((d) => {
    const each = bw[d.typeId]?.[1272] ?? 0
    const n = Math.max(0, Math.min(d.count, slots, each > 0 ? Math.floor(band / each + 1e-9) : slots))
    slots -= n
    band -= n * each
    return { ...d, active: n }
  })
  return { ...fit, drones }
}

function summarizeFit(fit: FitSpec, s: FitStats) {
  const d = s.defense
  // "hp; resists EM/Th/Ki/Ex" in one short line per layer.
  const layer = (l: FitStats['defense']['shield']) => `${Math.round(l.hp)} HP; ${l.resist.map((x) => Math.round(x * 100)).join('/')}%`
  // Identical weapons (same module and charge) as one line with the count.
  const weapons = new Map<string, FitStats['offense']['weapons'][number] & { n: number }>()
  for (const w of s.offense.weapons) {
    const key = `${w.typeId}|${w.chargeTypeId ?? 0}`
    const g = weapons.get(key)
    if (g) {
      g.n += w.count
      g.dps += w.dps
    } else weapons.set(key, { ...w, n: w.count })
  }
  const nz = (v: number | undefined, f: (x: number) => unknown) => (v ? f(v) : undefined)
  const sh = s.ship
  return {
    ship: en(fit.shipTypeId),
    cpu: `${r1(sh.cpu.used)}/${r1(sh.cpu.total)}`,
    pg: `${r1(sh.power.used)}/${r1(sh.power.total)}`,
    calibration: `${sh.calibration.used}/${sh.calibration.total}`,
    drones: sh.droneBay.total ? `bay ${sh.droneBay.used}/${sh.droneBay.total} m3, bw ${sh.droneBandwidth.used}/${sh.droneBandwidth.total}` : undefined,
    dps: r1(s.offense.totalDps),
    dps_reload: r1(s.offense.totalDpsReload),
    volley: Math.round(s.offense.totalVolley),
    weapons: [...weapons.values()].map((w) => ({
      w: `${w.n}x ${en(w.typeId)}${w.chargeTypeId ? ` / ${en(w.chargeTypeId)}` : ''}`,
      dps: r1(w.dps),
      dmg_em_th_ki_ex: w.damage.map((x) => Math.round(x)).join('/'),
      range_m: nz(w.optimal, Math.round),
      falloff_m: nz(w.falloff, Math.round),
      tracking: nz(w.tracking, (x) => r1(x, 4)),
      exp_radius: nz(w.explosionRadius, r1),
      exp_velocity: nz(w.explosionVelocity, r1)
    })),
    ehp: Math.round(d.ehp),
    shield: layer(d.shield),
    armor: layer(d.armor),
    hull: layer(d.hull),
    shield_recharge_s: r1(d.shieldRechargeSec),
    passive_regen_peak: nz(d.passiveShieldRegen, r1),
    reps_hp_s: d.shieldBoost + d.armorRepair + d.hullRepair ? { shield: nz(d.shieldBoost, r1), armor: nz(d.armorRepair, r1), hull: nz(d.hullRepair, r1) } : undefined,
    active_tank_ehp_s: nz(d.activeTankEhp, r1),
    cap: s.capacitor.stable
      ? `${Math.round(s.capacitor.capacity)} GJ, stable at ${pct(s.capacitor.stableLevel ?? 1)}`
      : `${Math.round(s.capacitor.capacity)} GJ, lasts ${Math.round(s.capacitor.lastsSec ?? 0)} s`,
    cap_use_vs_peak_recharge: `${r1(s.capacitor.usePerSecond, 2)}/${r1(s.capacitor.peakRecharge, 2)} GJ/s`,
    speed: r1(s.navigation.maxVelocity),
    align_s: r1(s.navigation.alignSec, 2),
    warp: r1(s.navigation.warpSpeed, 2),
    sig: r1(s.navigation.signatureRadius),
    lock: `${r1(s.targeting.maxRange / 1000)} km, ${Math.round(s.targeting.scanResolution)} mm, ${s.targeting.maxTargets} targets, ${r1(s.targeting.sensorStrength)} ${s.targeting.sensorType}`,
    problems: s.problems.length ? s.problems : undefined
  }
}

/** Skills the active character still needs for these items (prerequisites included). */
async function missingSkills(ctx: ToolContext, typeIds: number[]) {
  if (!ctx.char.skills) return undefined
  const req = await window.api.sde.requiredSkills(typeIds)
  const miss = Object.entries(req)
    .map(([id, r]) => ({ id: Number(id), need: r.level, have: ctx.char.level(Number(id)) }))
    .filter((x) => x.have < x.need)
  await names(miss.map((m) => m.id))
  return miss.map((m) => `${en(m.id)} ${m.have} → ${m.need}`)
}

/** Saved fits, optionally only those of one ship. */
const byShip = (list: { name: string; ship: string }[], ship?: string) => (ship ? list.filter((f) => f.ship.toLowerCase() === ship.toLowerCase()) : list)

const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required, additionalProperties: false })
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const num = (description: string) => ({ type: 'number', description })
const EFT = str('EFT text; omit = the fit open in Canopus')
const SKILLS = str('default character', { enum: ['character', 'all5'] })

interface Tool {
  def: ToolDef['function']
  run: (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>
  /** Changes something in the game: the user confirms first */
  inGame?: boolean
}

const tool = (name: string, description: string, parameters: Record<string, unknown>, run: Tool['run'], inGame = false): Tool => ({ def: { name, description, parameters }, run, inGame })

const TOOLS: Tool[] = [
  tool('app_state', 'Current page, characters, and the fit open in the fitting tool (EFT).', obj({}), async (_a, ctx) => {
    if (ctx.fit) await names([ctx.fit.shipTypeId, ...ctx.fit.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]), ...ctx.fit.drones.map((d) => d.typeId), ...ctx.fit.implants])
    return {
      page: ctx.page,
      ui_language: ctx.lang,
      characters: ctx.characters.map((c) => ({ name: c.name, active: c.id === ctx.active?.id })),
      open_fit_eft: ctx.fit ? toEft(ctx.fit) : null
    }
  }),

  tool(
    'character_overview',
    'A character now: location, ship, wallet, SP, skill queue, implants, attributes, industry, PI.',
    obj({ character: str('omit = active') }),
    async (a, ctx) => {
      const c = who(ctx, a.character)
      const row = await loadRow(c)
      const out: Record<string, unknown> = {
        name: c.name,
        online: row.online,
        system: row.system && { name: row.system.name, security: sec(row.system.sec) },
        docked: row.docked,
        ship: row.ship && { type: en(row.ship.type) || row.ship.type, name: row.ship.name },
        wallet_isk: row.wallet,
        industry_jobs: row.jobs,
        planetary: row.pi && { planets: row.pi.planets, first_extractor_ends: row.pi.earliest ? new Date(row.pi.earliest).toISOString() : null },
        skill_queue_ends: row.queueEnd ? new Date(row.queueEnd).toISOString() : row.queueEnd
      }
      if (c.id === ctx.active?.id) {
        const ch = ctx.char
        await names([...(ch.queue ?? []).map((q) => q.skill_id), ...(ch.implants ?? [])])
        Object.assign(out, {
          total_sp: ch.totalSp,
          unallocated_sp: ch.unallocatedSp,
          queue: (ch.queue ?? []).slice(0, 10).map((q) => `${en(q.skill_id)} ${q.finished_level}${q.finish_date ? ` → ${q.finish_date.slice(0, 16)}` : ''}`),
          implants: (ch.implants ?? []).map(en),
          attributes: ch.attributes
        })
      }
      if (row.ship) await names([row.ship.type])
      return out
    }
  ),

  tool(
    'character_skills',
    'Skill levels: named skills, a whole group (e.g. Missiles), or no args = per-group summary.',
    obj({ skills: { type: 'array', items: { type: 'string' } }, group: { type: 'string' } }),
    async (a, ctx) => {
      if (!ctx.char.skills) throw new Error('Навыки персонажа недоступны: войдите персонажем')
      const cat = await window.api.sde.skillCatalog()
      const lvl = (id: number) => ctx.char.skills!.get(id)?.active ?? 0
      if (a.skills?.length) {
        const all = cat.flatMap((g) => g.skills)
        return (a.skills as string[]).map((n) => {
          const s = all.find((x) => x.n.some((v) => v.toLowerCase() === n.toLowerCase()))
          return s ? { skill: s.n[0], level: lvl(s.id), rank: s.rank } : { skill: n, error: 'not found' }
        })
      }
      if (a.group) {
        const g = cat.find((x) => x.n.some((v) => v.toLowerCase() === String(a.group).toLowerCase()))
        if (!g) return { error: 'group not found', groups: cat.map((x) => x.n[0]) }
        return g.skills.filter((s) => s.pub).map((s) => ({ skill: s.n[0], level: lvl(s.id), rank: s.rank }))
      }
      return cat.map((g) => {
        const trained = g.skills.filter((s) => lvl(s.id) > 0)
        return { group: g.n[0], trained: trained.length, of: g.skills.filter((s) => s.pub).length, at_level_5: trained.filter((s) => lvl(s.id) === 5).length }
      })
    }
  ),

  tool(
    'knowledge_search',
    'Search the EVE knowledge base: EVE University wiki (mechanics, guides, missions, exploration, PvP), CCP news and patch notes, Canopus notes with formulas. Query in English with game terms.',
    obj({ query: { type: 'string' }, source: { type: 'string', enum: ['uni', 'ccp', 'notes'] }, limit: num('default 6') }, ['query']),
    async (a) => {
      const hits = await window.api.knowledge.search(a.query, Math.min(10, a.limit ?? 6), a.source)
      if (!hits.length) {
        const st = await window.api.knowledge.status()
        return { results: [], note: st.articles.uni ? 'nothing found: try other English terms' : 'the knowledge base is not downloaded yet' }
      }
      return hits.map((h) => ({ source: h.source, title: h.section ? `${h.title} — ${h.section}` : h.title, url: h.url, date: h.date, text: h.text }))
    }
  ),

  tool('search_items', 'Find items by name (EN/RU, partial).', obj({ query: { type: 'string' }, limit: { type: 'number' } }, ['query']), async (a) => {
    const hits = await window.api.sde.search(a.query, { limit: a.limit ?? 10 })
    const groups = await window.api.sde.groupNames([...new Set(hits.map((h) => h.g))])
    return hits.map((h) => ({ name: h.n[0], ...(h.n[1] !== h.n[0] ? { ru: h.n[1] } : {}), group: groups[h.g]?.[0] }))
  }),

  tool(
    'item_info',
    'Game data for one item: attributes, ship bonuses, required skills, other versions.',
    obj({ item: str('name or id'), description: { type: 'boolean', description: 'include the lore text' } }, ['item']),
    async (a, ctx) => {
      const id = await findType(a.item)
      if (!id) throw new Error(`Предмет «${a.item}» не найден`)
      const info = await window.api.sde.info(id)
      primeBasics(info.refs)
      await names(info.variations)
      const bonus = (b: { b?: number; u?: number; t: [string, string] | string[] }) => `${b.b !== undefined ? `${b.b}${b.u === 105 ? '%' : ''} ` : ''}${b.t[0]}`
      const req = (nodes: typeof info.requirements): string[] => nodes.flatMap((n) => [`${en(n.skill)} ${n.level}`, ...req(n.children)])
      return {
        name: info.type.n[0],
        group: info.group.n[0],
        category: info.category.n[0],
        meta: info.meta?.[0],
        description: a.description ? info.description?.[ctx.lang === 'ru' ? 1 : 0]?.replace(/<[^>]+>/g, '').slice(0, 800) : undefined,
        // "Name: value unit" lines are a third of the size of objects.
        attributes: info.attributes
          .filter((x) => x.value !== 0)
          .slice(0, 80)
          .map((x) => `${x.n[0]}: ${r1(x.value, 4)}${x.unit !== undefined && info.units[x.unit]?.[0] ? ` ${info.units[x.unit][0]}` : ''}`),
        traits: info.traits && {
          role: info.traits.role?.map(bonus),
          per_skill_level: info.traits.skills?.map((s) => ({ skill: en(s.skill), bonuses: s.bonuses.map(bonus) })),
          misc: info.traits.misc?.map(bonus)
        },
        required_skills: [...new Set(req(info.requirements))],
        variations: info.variations.map(en)
      }
    }
  ),

  tool(
    'market_prices',
    'Best sell/buy prices and volumes at a trade hub (default Jita).',
    obj({ items: { type: 'array', items: { type: 'string' } }, hub: { type: 'string', enum: HUBS.map((h) => h.name) } }, ['items']),
    async (a) => {
      const hub = HUBS.find((h) => h.name === a.hub) ?? HUBS[0]
      const ids = await Promise.all((a.items as string[]).map(findType))
      const prices = await hubPrices(hub.stationId, ids.filter((x): x is number => !!x))
      await names(ids.filter((x): x is number => !!x))
      return (a.items as string[]).map((n, i) => {
        const id = ids[i]
        const p = id ? prices.get(id) : undefined
        return id && p ? { item: en(id), sell: p.sell.best, sell_vol: p.sell.volume, buy: p.buy.best, buy_vol: p.buy.volume } : { item: n, error: 'no price' }
      })
    }
  ),

  tool(
    'calculate_fit',
    'All stats of a fit by the game formulas (DPS, EHP/resists, tank, cap, speed, targeting, CPU/PG, problems, missing skills). Use instead of estimating.',
    obj({ eft: EFT, skills: SKILLS }),
    async (a, ctx) => {
      const fit = await parseFit(a.eft, ctx)
      const stats = await window.api.fit.calculate(fit, skillsFor(ctx, a.skills))
      await names([fit.shipTypeId, ...stats.offense.weapons.flatMap((w) => [w.typeId, w.chargeTypeId ?? 0])])
      const ids = [fit.shipTypeId, ...fit.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]), ...fit.drones.map((d) => d.typeId)].filter(Boolean)
      return { ...summarizeFit(fit, stats), skills_used: skillsFor(ctx, a.skills).mode === 'char' ? ctx.active?.name : 'all V', missing_skills: await missingSkills(ctx, ids) }
    }
  ),

  tool(
    'optimize_fit',
    'Swap modules for other versions by Jita price. cheaper: keep all stats (tolerance = allowed loss 0-0.1). better: most gain in metric per ISK within budget per swap.',
    obj(
      {
        eft: EFT,
        skills: SKILLS,
        mode: { type: 'string', enum: ['cheaper', 'better'] },
        tolerance: { type: 'number' },
        metric: { type: 'string', enum: METRICS.map(([m]) => m) },
        budget_isk: num('default 200M')
      },
      ['mode']
    ),
    async (a, ctx) => {
      const fit = await parseFit(a.eft, ctx)
      const skills = skillsFor(ctx, a.skills)
      const d = await loadVariants(fit, skills)
      await names(d.options.flatMap((o) => [o.from, o.to]))
      if (a.mode === 'cheaper') {
        const r = await findCheaper(d, fit, skills, a.tolerance ?? 0)
        const result = r.picks.reduce((f, p) => swap(f, p.v), fit)
        await names([result.shipTypeId, ...result.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]), ...result.drones.map((x) => x.typeId)])
        return {
          swaps: r.picks.map((p) => ({ from: `${p.v.count}x ${en(p.v.from)}`, to: en(p.v.to), saving_isk: Math.round(p.saving), changes: sideEffects(p.v.metrics, d.base) || 'none' })),
          total_saving_isk: Math.round(r.picks.reduce((s, p) => s + p.saving, 0)),
          optimized_eft: r.picks.length ? toEft(result) : null
        }
      }
      const list = findUpgrades(d, (a.metric ?? 'dps') as Metric, a.budget_isk ?? 200e6)
      return list.map((u) => ({ from: `${u.v.count}x ${en(u.v.from)}`, to: en(u.v.to), gain: `${r1(u.g)}%`, extra_cost_isk: Math.round(u.cost), side_effects: sideEffects(u.v.metrics, d.base, (a.metric ?? 'dps') as Metric) }))
    }
  ),

  tool(
    'what_to_learn',
    'Next skill levels that improve a fit most per hour of training.',
    obj({ eft: EFT, metric: { type: 'string', enum: ['dps', 'ehp', 'activeTank', 'speed', 'align', 'lockRange', 'capacitor'] } }),
    async (a, ctx) => {
      const ch = ctx.char
      if (!ch.skills) throw new Error('Нужен персонаж с навыками')
      const fit = await parseFit(a.eft, ctx)
      const levels = Object.fromEntries([...ch.skills.entries()].map(([id, s]) => [id, s.active]))
      const gains = await window.api.fit.skillGains(fit, levels)
      const attrs = await window.api.sde.dogmaAttrs(gains.map((g) => g.skill), [275, 180, 181])
      await names(gains.map((g) => g.skill))
      const metric = (a.metric ?? 'dps') as keyof (typeof gains)[number]
      return gains
        .map((g) => {
          const at = attrs[g.skill] ?? {}
          const rate = (ch.attributes?.[at[180]] ?? 0) + (ch.attributes?.[at[181]] ?? 0) / 2
          const need = Math.max(0, spForLevel(at[275] ?? 1, g.from + 1) - Math.max(ch.skills!.get(g.skill)?.sp ?? 0, spForLevel(at[275] ?? 1, g.from)))
          const hours = rate ? need / rate / 60 : Infinity
          const v = metric === 'align' ? -g.align : (g[metric] as number)
          return { skill: `${en(g.skill)} ${g.from} → ${g.from + 1}`, gain: r1(v, 2), hours: r1(hours), per_hour: v / Math.max(hours, 0.05) }
        })
        .filter((x) => x.gain > 0)
        .sort((x, y) => y.per_hour - x.per_hour)
        .slice(0, 15)
        .map(({ per_hour, ...x }) => ({ ...x, gain_per_hour: r1(per_hour, 3) }))
    }
  ),

  tool(
    'skill_plan',
    'Skills to train (with prerequisites) to use items, with training time.',
    obj({ items: { type: 'array', items: { type: 'string' }, description: 'items or skills, e.g. "Caldari Cruiser 5"' } }, ['items']),
    async (a, ctx) => {
      const goals = await Promise.all(
        (a.items as string[]).map(async (s) => {
          const m = /^(.*?)\s+([1-5])$/.exec(s.trim())
          const id = await findType(m ? m[1] : s)
          if (!id) throw new Error(`Не найдено: ${s}`)
          return { typeId: id, level: m ? Number(m[2]) : undefined }
        })
      )
      const plan = await window.api.sde.skillPlan(goals)
      const ch = ctx.char
      const steps = plan.filter((p) => ch.level(p.skill) < p.level)
      await names(steps.map((s) => s.skill))
      let total = 0
      const out = steps.map((p) => {
        const rate = (ch.attributes?.[p.primary] ?? 20) + (ch.attributes?.[p.secondary] ?? 20) / 2
        const sp = Math.max(0, spForLevel(p.rank, p.level) - Math.max(ch.skills?.get(p.skill)?.sp ?? 0, spForLevel(p.rank, p.level - 1)))
        const h = sp / rate / 60
        total += h
        return { skill: `${en(p.skill)} ${p.level}`, hours: r1(h) }
      })
      return { steps: out, total_hours: r1(total), total_days: r1(total / 24) }
    }
  ),

  tool(
    'simulate_combat',
    'Combat simulator, two fits: applied DPS both ways and time to kill (application, webs, painters, scram vs MWD, cap-limited reps).',
    obj(
      {
        my_eft: EFT,
        enemy_eft: { type: 'string' },
        distance_km: num('default 10'),
        my_speed: num('m/s, omit = top'),
        enemy_speed: num('m/s, omit = top'),
        enemy_heading_deg: num('0 away, 90 orbit (default), 180 towards'),
        my_heading_deg: num('0 towards (default), 90 sideways'),
        skills: SKILLS
      },
      ['enemy_eft']
    ),
    async (a, ctx) => {
      const me: CombatPilot = { fit: await parseFit(a.my_eft, ctx), skills: skillsFor(ctx, a.skills) }
      const parsed = await fromEft(a.enemy_eft)
      if (parsed.unknown.length) throw new Error(`Неизвестные предметы в фите противника: ${parsed.unknown.join(', ')}`)
      const enemy: CombatPilot = { fit: await launchDrones(parsed.fit, { mode: 'all5' }), skills: { mode: 'all5' } }
      const d = await window.api.combat.defaults(me, enemy)
      const r = await window.api.combat.simulate(me, enemy, {
        distance: (a.distance_km ?? 10) * 1000,
        speedA: a.my_speed ?? d.speedA,
        headingA: a.my_heading_deg ?? 0,
        speedB: a.enemy_speed ?? d.speedB,
        headingB: a.enemy_heading_deg ?? 90
      })
      await names([r.a.shipTypeId, r.b.shipTypeId, ...r.a.effects.map((e) => e.typeId), ...r.b.effects.map((e) => e.typeId)])
      const side = (s: typeof r.a) => ({
        ship: en(s.shipTypeId),
        top_speed: r1(s.maxVelocity),
        speed_used: r1(s.speed),
        signature: r1(s.signature),
        ehp: Math.round(s.ehp),
        prop: s.prop && { on: s.prop.on, blocked_by_scram: s.prop.blocked },
        affected_by: s.effects.map((e) => `${e.kind} ${en(e.typeId)} x${e.count}: ${r1(e.value)}%`)
      })
      const dir = (x: typeof r.ab) => ({ paper_dps: r1(x.paperDps), applied_dps: r1(x.applied), time_to_kill_s: Number.isFinite(x.timeToKill) ? Math.round(x.timeToKill) : 'never', limits: [...new Set(x.weapons.map((w) => w.limit).filter(Boolean))], cap_warning: x.capWarning })
      return { you: side(r.a), opponent: side(r.b), you_to_opponent: dir(r.ab), opponent_to_you: dir(r.ba), transversal_m_s: r1(r.transversal) }
    }
  ),

  tool(
    'list_fits',
    'Saved fits in Canopus or in the game: names (filter by ship), or one fit as EFT by name.',
    obj({ source: { type: 'string', enum: ['canopus', 'game'] }, ship: str('only fits of this ship'), name: str('return this fit as EFT') }, ['source']),
    async (a, ctx) => {
      if (a.source === 'canopus') {
        const fits = await window.api.fit.list()
        await names(fits.flatMap((f) => [f.shipTypeId, ...f.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]), ...f.drones.map((d) => d.typeId), ...f.implants]))
        const one = !a.name ? undefined : fits.find((f) => f.name.toLowerCase() === String(a.name).toLowerCase())
        return one ? { eft: toEft(one) } : byShip(fits.map((f) => ({ name: f.name, ship: en(f.shipTypeId) })), a.ship)
      }
      const c = who(ctx)
      const fits = await loadGameFits(c.id)
      await names(fits.map((f) => f.ship_type_id))
      const one = !a.name ? undefined : fits.find((f) => f.name.toLowerCase() === String(a.name).toLowerCase())
      if (one) {
        const fit = await fromEsiItems(one.ship_type_id, one.name, one.items.map((i) => ({ typeId: i.type_id, flag: i.flag, qty: i.quantity })))
        await names([fit.shipTypeId, ...fit.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]), ...fit.drones.map((d) => d.typeId)])
        return { eft: toEft(fit) }
      }
      return byShip(fits.map((f) => ({ name: f.name, ship: en(f.ship_type_id) })), a.ship)
    }
  ),

  tool(
    'current_ship_fit',
    'The fit of the ship the character is flying right now (modules, charges, rigs, drones, cargo from the game), as EFT. Use for "my ship" questions; ESI may lag by up to an hour after refits.',
    obj({ character: str('omit = active') }),
    async (a, ctx) => {
      const c = who(ctx, a.character)
      const fit = await currentShipFit(c, skillsFor(ctx))
      await names([fit.shipTypeId, ...fit.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]), ...fit.drones.map((d) => d.typeId), ...(fit.cargo ?? []).map((x) => x.typeId)])
      return { eft: toEft(fit) }
    }
  ),

  tool(
    'npc_damage',
    'How a fit kills mission NPCs of a faction: per class (frigate…battleship) the share of DPS that lands, applied DPS, seconds to kill through their resists and repairs, what limits it, and the time to clear a typical L4 room. The way to compare fits and ships for missions.',
    obj({ eft: EFT, faction: { type: 'string', enum: NPC_FACTIONS }, distance_km: num('omit = each NPC at its orbit distance'), skills: SKILLS }, ['faction']),
    async (a, ctx) => {
      const fit = await parseFit(a.eft, ctx)
      return npcSummary(await window.api.fit.npcDamage(fit, skillsFor(ctx, a.skills), a.faction as NpcFaction, a.distance_km ? a.distance_km * 1000 : undefined))
    }
  ),

  tool(
    'compare_fits',
    'Several fits at once (one call instead of many): DPS, EHP, active tank, capacitor, speed, lock range, CPU/PG, missing skills, Jita price of hull + modules + drones, and with a faction the time to clear a typical L4 room of it.',
    obj({ efts: { type: 'array', items: { type: 'string' } }, faction: { type: 'string', enum: NPC_FACTIONS }, skills: SKILLS }, ['efts']),
    async (a, ctx) => {
      const skills = skillsFor(ctx, a.skills)
      const fits = await Promise.all((a.efts as string[]).slice(0, 6).map((e) => parseFit(e, ctx)))
      const ids = [...new Set(fits.flatMap((f) => [f.shipTypeId, ...f.modules.map((m) => m.typeId), ...f.drones.map((d) => d.typeId)]))]
      const [prices] = await Promise.all([jitaPrices(ids), names(ids)])
      const price = (id: number) => (prices.get(id)?.sell.best as number | undefined) ?? 0
      return Promise.all(
        fits.map(async (f) => {
          const s = await window.api.fit.calculate(f, skills)
          const npc = a.faction ? await window.api.fit.npcDamage(f, skills, a.faction as NpcFaction) : null
          const cost = price(f.shipTypeId) + f.modules.reduce((x, m) => x + price(m.typeId), 0) + f.drones.reduce((x, d) => x + price(d.typeId) * d.count, 0)
          const miss = await missingSkills(ctx, [f.shipTypeId, ...f.modules.map((m) => m.typeId), ...f.drones.map((d) => d.typeId)])
          return {
            fit: `${en(f.shipTypeId)} — ${f.name}`,
            dps: r1(s.offense.totalDps),
            dps_reload: r1(s.offense.totalDpsReload),
            ehp: Math.round(s.defense.ehp),
            active_tank_ehp_s: r1(s.defense.activeTankEhp),
            cap: s.capacitor.stable ? `stable ${pct(s.capacitor.stableLevel ?? 1)}` : `${Math.round(s.capacitor.lastsSec ?? 0)} s`,
            speed: r1(s.navigation.maxVelocity),
            lock_km: r1(s.targeting.maxRange / 1000),
            fits_cpu_pg: s.ship.cpu.used <= s.ship.cpu.total && s.ship.power.used <= s.ship.power.total,
            missing_skills: miss?.length ? miss : undefined,
            jita_price_isk: Math.round(cost),
            ...(npc ? { l4_room_clear_s: fmtTtk(npc.room.seconds), per_class_ttk_s: Object.fromEntries(npc.classes.map((c) => [c.cls, fmtTtk(c.ttkMedian)])) } : {})
          }
        })
      )
    }
  ),

  tool('open_fit', 'Open a fit in the Canopus fitting tool (the fit open before can be restored from the chat).', obj({ eft: { type: 'string' } }, ['eft']), async (a, ctx) => {
    const fit = await parseFit(a.eft, ctx)
    if (ctx.fit) ctx.replaced?.(ctx.fit)
    ctx.openFit(fit)
    return { opened: true }
  }),

  tool(
    'navigate',
    'Open a Canopus section; market+item opens its prices, pvp+character their stats.',
    obj({ page: { type: 'string', enum: PAGES }, item: { type: 'string' }, character: { type: 'string' } }, ['page']),
    async (a, ctx) => {
      let arg: number | null = null
      if (a.page === 'market' && a.item) arg = await findType(a.item)
      if (a.page === 'pvp' && a.character) arg = (await esi<{ characters?: { id: number }[] }>('/universe/ids/', { method: 'POST', body: [a.character] })).characters?.[0]?.id ?? null
      ctx.navigate(a.page as PageId, arg)
      return { opened: a.page }
    }
  ),

  tool(
    'route',
    'Gate route with security per system; check_danger adds last-hour kills, camps, bubbles, smartbombs.',
    obj({ from: str('omit = current location'), to: { type: 'string' }, preference: { type: 'string', enum: ['secure', 'shortest', 'insecure'] }, check_danger: { type: 'boolean' } }, ['to']),
    async (a, ctx) => {
      let fromId: number | null = null
      if (a.from) fromId = (await findSystem(a.from))?.id ?? null
      else {
        const c = who(ctx)
        fromId = (await esi<{ solar_system_id: number }>(`/characters/${c.id}/location/`, { characterId: c.id })).solar_system_id
      }
      const to = await findSystem(a.to)
      if (!fromId || !to) throw new Error('Система не найдена')
      const r = await window.api.sde.routeLocal(fromId, to.id, a.preference ?? 'shortest', [])
      if (!r) return { error: 'no route' }
      const systems = await Promise.all(r.ids.map((id) => window.api.sde.system(id)))
      // Region once per stretch instead of on every system.
      const out = systems.map((s, i) => ({ system: s?.n, sec: s ? sec(s.sec) : undefined, ...(s && s.region[0] !== systems[i - 1]?.region[0] ? { region: s.region[0] } : {}) }))
      if (a.check_danger) {
        const danger = await Promise.all(r.ids.slice(0, 40).map((id) => systemDanger(id).catch(() => null)))
        // Every checked system says so, also when nothing happened: no data is not the same as quiet.
        danger.forEach((d, i) =>
          Object.assign(out[i], d ? { kills_1h: d.kills.length, ...(d.camps.length ? { camps: d.camps.length } : {}), ...(d.bubbles ? { bubbles: true } : {}), ...(d.smartbombs ? { smartbombs: true } : {}) } : { danger_check: 'failed' })
        )
        out.slice(40).forEach((o) => Object.assign(o, { danger_check: 'not checked (route longer than 40 jumps)' }))
      }
      return { jumps: r.ids.length - 1, ...(a.check_danger ? { note: 'kills_1h = player ship losses in the last hour (0 = none)' } : {}), systems: out }
    }
  ),

  tool('system_info', 'A system: security, region, last-hour player kills, camps, NPC kills.', obj({ system: { type: 'string' } }, ['system']), async (a) => {
    const s = await findSystem(a.system)
    if (!s) throw new Error('Система не найдена')
    const full = await window.api.sde.system(s.id)
    const [d, kills] = await Promise.all([systemDanger(s.id).catch(() => null), esi<{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }[]>('/universe/system_kills/').catch(() => [])])
    const k = kills.find((x) => x.system_id === s.id)
    return {
      system: full?.n,
      security: full && sec(full.sec),
      region: full?.region[0],
      // wc 7-9 mark high/low/null-sec k-space: only wormhole classes mean something here.
      wormhole_class: full?.wc && (full.wc <= 6 || full.wc >= 12) ? full.wc : undefined,
      last_hour_player_kills: d?.kills.length,
      camps: d?.camps.length,
      bubbles: d?.bubbles,
      smartbombs: d?.smartbombs,
      ship_kills_last_hour: k?.ship_kills ?? 0,
      pod_kills_last_hour: k?.pod_kills ?? 0,
      npc_kills_last_hour: k?.npc_kills ?? 0
    }
  }),

  tool(
    'trade_profit',
    'Trading profit from the wallet (sells matched to earlier buys), turnover, taxes, fees.',
    obj({ days: num('default 30'), all_characters: { type: 'boolean' } }),
    async (a, ctx) => {
      const chars = a.all_characters ? ctx.characters : [who(ctx)]
      const per = await Promise.all(
        chars.map(async (c) => ({
          txs: (await transactions(c.id).catch(() => [] as Tx[])).filter((t) => t.is_personal),
          journal: await esi<Journal[]>(`/characters/${c.id}/wallet/journal/`, { characterId: c.id, allPages: true }).catch(() => [] as Journal[])
        }))
      )
      const since = Date.now() - (a.days ?? 30) * 86400_000
      const items = profitByItem(per.flatMap((p) => p.txs), since)
      const j = per.flatMap((p) => p.journal).filter((e) => Date.parse(e.date) >= since)
      const fee = (t: string) => -j.filter((e) => e.ref_type === t).reduce((s, e) => s + (e.amount ?? 0), 0)
      await names(items.map((i) => i.type))
      const gross = items.reduce((s, i) => s + i.profit, 0)
      return {
        days: a.days ?? 30,
        gross_profit: Math.round(gross),
        sales_tax: Math.round(fee('transaction_tax')),
        broker_fees: Math.round(fee('brokers_fee')),
        net_profit: Math.round(gross - fee('transaction_tax') - fee('brokers_fee')),
        turnover: Math.round(items.reduce((s, i) => s + i.soldIsk, 0)),
        best: [...items].sort((x, y) => y.profit - x.profit).slice(0, 10).map((i) => ({ item: en(i.type), sold: i.sold, profit: Math.round(i.profit) })),
        worst: [...items].filter((i) => i.profit < 0).sort((x, y) => x.profit - y.profit).slice(0, 5).map((i) => ({ item: en(i.type), profit: Math.round(i.profit) })),
        unsold: items.filter((i) => i.left > 0).sort((x, y) => y.leftCost - x.leftCost).slice(0, 10).map((i) => ({ item: en(i.type), qty: i.left, cost: Math.round(i.leftCost) }))
      }
    }
  ),

  tool(
    'find_assets',
    "Where the character's items are (asset search by name).",
    obj({ query: { type: 'string' } }, ['query']),
    async (a, ctx) => {
      const c = who(ctx)
      const assets = await esi<{ item_id: number; type_id: number; location_id: number; quantity: number; location_flag: string }[]>(`/characters/${c.id}/assets/`, { characterId: c.id, allPages: true })
      await names(assets.map((x) => x.type_id))
      const byItem = new Map(assets.map((x) => [x.item_id, x]))
      // Items inside ships and containers: climb to the station / structure that holds them.
      const root = (x: (typeof assets)[number]) => {
        let cur = x
        for (let i = 0; i < 5 && byItem.has(cur.location_id); i++) cur = byItem.get(cur.location_id)!
        return cur.location_id
      }
      const q = String(a.query).toLowerCase()
      const hits = assets.filter((x) => getBasic(x.type_id)?.n.some((n) => n.toLowerCase().includes(q))).slice(0, 60)
      const locs = await resolveLocations(new Set(hits.map(root)), c.id)
      return hits.map((x) => ({ item: en(x.type_id), qty: x.quantity, location: locs.get(root(x)) ?? root(x), inside: byItem.has(x.location_id) ? en(byItem.get(x.location_id)!.type_id) : undefined }))
    }
  ),

  tool('all_characters', 'All characters: system, ship, wallet, queue end, industry, PI, fatigue, clone.', obj({}), async (_a, ctx) => {
    const rows = await Promise.all(ctx.characters.map(loadRow))
    await names(rows.flatMap((r) => (r.ship ? [r.ship.type] : [])))
    const t = (v?: number | null) => (v === undefined ? undefined : v === null ? null : new Date(v).toISOString())
    return rows.map((r) => ({
      name: r.name,
      online: r.online,
      system: r.system?.name,
      ship: r.ship && en(r.ship.type),
      wallet_isk: r.wallet,
      skill_queue_ends: t(r.queueEnd),
      industry_jobs: r.jobs,
      extractors_end: r.pi && t(r.pi.earliest),
      jump_fatigue_ends: t(r.fatigueEnd),
      jump_clone_ready: t(r.cloneReady)
    }))
  }),

  tool(
    'set_destination',
    'IN-GAME: set the autopilot destination or add a waypoint (user confirms).',
    obj({ system: { type: 'string' }, add_waypoint: { type: 'boolean' } }, ['system']),
    async (a, ctx) => {
      const c = who(ctx)
      if (!hasScope(c, SCOPE.waypoint)) throw new Error('Нет разрешения на действия в игре: войдите с расширенными разрешениями в Настройках')
      const s = await findSystem(a.system)
      if (!s) throw new Error('Система не найдена')
      await setDestinationInGame(c, s.id, !!a.add_waypoint)
      return { done: true, system: s.n }
    },
    true
  ),

  tool(
    'save_fit_to_game',
    'IN-GAME: save a fit to the game fittings list (user confirms).',
    obj({ eft: { type: 'string' } }, ['eft']),
    async (a, ctx) => {
      const c = who(ctx)
      if (!hasScope(c, SCOPE.writeFits)) throw new Error('Нет разрешения сохранять фиты в игру: войдите с расширенными разрешениями')
      const fit = await parseFit(a.eft, ctx)
      const id = await saveFitToGame(c, fit)
      return { saved: true, fitting_id: id }
    },
    true
  )
]

export const TOOL_DEFS: ToolDef[] = TOOLS.map((t) => ({ type: 'function', function: t.def }))

/** Short human description of a tool call for the chat log. */
export const TOOL_LABELS: Record<string, string> = {
  web_search: 'Ищу в интернете',
  current_ship_fit: 'Фит текущего корабля',
  npc_damage: 'Урон по NPC миссий',
  compare_fits: 'Сравниваю фиты',
  knowledge_search: 'Ищу в базе знаний',
  enable_web_search: 'Подключаю поиск в интернете',
  app_state: 'Смотрю, что открыто в Canopus',
  character_overview: 'Данные персонажа',
  character_skills: 'Навыки персонажа',
  search_items: 'Ищу предметы',
  item_info: 'Информация о предмете',
  market_prices: 'Цены на рынке',
  calculate_fit: 'Считаю фит',
  optimize_fit: 'Оптимизирую фит',
  what_to_learn: 'Что выучить для фита',
  skill_plan: 'План навыков',
  simulate_combat: 'Симуляция боя',
  list_fits: 'Сохранённые фиты',
  open_fit: 'Открываю фит в фитинге',
  navigate: 'Открываю раздел',
  route: 'Прокладываю маршрут',
  system_info: 'Информация о системе',
  trade_profit: 'Прибыль от торговли',
  find_assets: 'Ищу имущество',
  all_characters: 'Все персонажи',
  set_destination: 'Маршрут в игре',
  save_fit_to_game: 'Сохраняю фит в игру'
}

/** Runs one tool call; errors go back to the model as text so it can correct itself. */
export async function runTool(name: string, rawArgs: string, ctx: ToolContext, confirm: (text: string) => Promise<boolean>): Promise<string> {
  const t = TOOLS.find((x) => x.def.name === name)
  if (!t) return JSON.stringify({ error: `unknown tool ${name}` })
  try {
    const args = rawArgs ? JSON.parse(rawArgs) : {}
    if (t.inGame && !(await confirm(`${TOOL_LABELS[name]}: ${JSON.stringify(args)}`))) return JSON.stringify({ error: 'The user declined this in-game action' })
    const out = await t.run(args, ctx)
    const text = JSON.stringify(out)
    // Keep one tool result from flooding the conversation.
    return text.length > 30_000 ? text.slice(0, 30_000) + '…(truncated)' : text
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message })
  }
}
