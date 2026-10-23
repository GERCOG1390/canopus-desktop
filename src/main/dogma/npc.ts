// How fast a fit kills mission NPCs: the fit's weapons applied (turret hit chance, missile application,
// drones keeping pace) against the NPCs of a faction as the SDE describes them — HP per layer, resists,
// signature, orbit speed and distance — through their resists and self-repairs.

import type { FitSpec, LayerStats, SkillSource } from '../../shared/fit'
import type { NpcClassResult, NpcFaction, NpcReport } from '../../shared/npc'
import { sdeForDogma } from '../sde'
import { application } from './combat'
import { calculateFit } from './index'

/** Mission NPC groups: pirates fly the "Deadspace" groups, empires and others the "Mission" groups. */
const FACTION_GROUP: Record<NpcFaction, string> = {
  guristas: 'Deadspace Guristas',
  serpentis: 'Deadspace Serpentis',
  blood_raiders: 'Deadspace Blood Raiders',
  sansha: "Deadspace Sansha's Nation",
  angel: 'Deadspace Angel Cartel',
  rogue_drones: 'Deadspace Rogue Drone',
  amarr: 'Mission Amarr Empire',
  caldari: 'Mission Caldari State',
  gallente: 'Mission Gallente Federation',
  minmatar: 'Mission Minmatar Republic',
  khanid: 'Mission Khanid',
  thukker: 'Mission Thukker',
  mordu: 'Mission Mordu',
  concord: 'Mission CONCORD'
}

export const NPC_CLASSES = ['frigate', 'destroyer', 'cruiser', 'battlecruiser', 'battleship'] as const
type NpcClass = (typeof NPC_CLASSES)[number]

/** A typical level 4 room for the "whole room" estimate (counts per class). */
const ROOM: Record<NpcClass, number> = { frigate: 4, destroyer: 2, cruiser: 4, battlecruiser: 2, battleship: 4 }

const A = {
  shield: 263,
  armor: 265,
  hull: 9,
  sig: 552,
  cruise: 508,
  maxVelocity: 37,
  orbit: 416,
  shieldRes: [271, 274, 273, 272],
  armorRes: [267, 270, 269, 268],
  hullRes: [113, 110, 109, 111],
  shieldBoost: 637,
  shieldBoostCycle: 636,
  armorRep: 631,
  armorRepCycle: 630
}

interface Npc {
  id: number
  name: string
  hp: [number, number, number]
  /** Damage that gets through per layer and type (resonance = 1 - resist) */
  res: [number[], number[], number[]]
  sig: number
  speed: number
  orbit: number
  /** HP/s the NPC repairs on shield and armor */
  reps: [number, number]
}

function npcsOf(faction: NpcFaction, cls: NpcClass): Npc[] {
  const d = sdeForDogma()
  const prefix = FACTION_GROUP[faction].toLowerCase()
  const groups = Object.entries(d.groups)
    .filter(([, g]) => {
      // Exact name: "… Battlecruiser" also ends in "cruiser".
      return g.n[0].toLowerCase() === `${prefix} ${cls}`
    })
    .map(([id]) => Number(id))
  const out: Npc[] = []
  for (const t of Object.values(d.types)) {
    if (!groups.includes(t.g)) continue
    const a = d.dogma[t.id]?.a ?? {}
    const hp: [number, number, number] = [a[A.shield] ?? 0, a[A.armor] ?? 0, a[A.hull] ?? 0]
    if (hp[0] + hp[1] + hp[2] <= 0) continue
    const res = (ids: number[]) => ids.map((i) => a[i] ?? 1)
    const perSec = (amount: number, cycleMs: number) => (amount && cycleMs ? amount / (cycleMs / 1000) : 0)
    out.push({
      id: t.id,
      name: t.n[0],
      hp,
      res: [res(A.shieldRes), res(A.armorRes), res(A.hullRes)],
      sig: a[A.sig] ?? 100,
      speed: a[A.cruise] || a[A.maxVelocity] || 0,
      orbit: a[A.orbit] || 5000,
      reps: [perSec(a[A.shieldBoost], a[A.shieldBoostCycle]), perSec(a[A.armorRep], a[A.armorRepCycle])]
    })
  }
  return out
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/**
 * The fit against every mission NPC of a class: applied damage per type through each layer's resists,
 * time to kill (NPC repairs subtracted; a layer the damage can't beat makes it "never").
 * The NPC orbits at its orbit distance and cruise speed; the shooter sits still (or at `distance`).
 */
export function npcDamage(spec: FitSpec, skills: SkillSource, faction: NpcFaction, distance?: number): NpcReport {
  const stats = calculateFit(spec, skills)
  const weapons = stats.offense.weapons
  // The pilot flies into their own weapons' reach (drones excluded: they fly to the target).
  const reach = Math.max(0, ...weapons.map((w) => (w.kind === 'turret' ? (w.optimal ?? 0) + (w.falloff ?? 0) * 0.5 : w.kind === 'missile' ? (w.optimal ?? 0) : 0)))
  const classes: NpcClassResult[] = []
  for (const cls of NPC_CLASSES) {
    const npcs = npcsOf(faction, cls)
    if (!npcs.length) continue
    const rows = npcs.map((n) => {
      const dist = distance ?? (reach > 0 ? Math.min(n.orbit, reach * 0.95) : n.orbit)
      const geo = { distance: dist, transversal: n.speed, targetSpeed: n.speed, targetSig: n.sig, receding: 0 }
      const byType = [0, 0, 0, 0]
      let paper = 0
      let applied = 0
      const limits = new Set<string>()
      for (const w of weapons) {
        const { factor, limit } = application(w, geo)
        paper += w.dps
        applied += w.dps * factor
        if (limit && factor < 0.9) limits.add(limit)
        w.damage.forEach((x, k) => (byType[k] += (x / (w.cycle || 1)) * factor))
      }
      const through = (layer: number) => byType.reduce((s, x, k) => s + x * n.res[layer][k], 0)
      const eff = [through(0) - n.reps[0], through(1) - n.reps[1], through(2)]
      const ttk = n.hp.reduce((s, hp, i) => (hp <= 0 ? s : eff[i] > 0 ? s + hp / eff[i] : Infinity), 0)
      return { n, paper, applied, ttk, limits, dist }
    })
    const finite = rows.filter((r) => Number.isFinite(r.ttk))
    // A true median: NPCs the fit can't kill count as the slowest, not as missing.
    const ttk = median(rows.map((r) => r.ttk))
    const sorted = [...rows].sort((a, b) => a.ttk - b.ttk)
    classes.push({
      cls,
      count: rows.length,
      application: median(rows.map((r) => (r.paper ? r.applied / r.paper : 0))),
      appliedDps: median(rows.map((r) => r.applied)),
      ttkMedian: ttk,
      fastest: { name: sorted[0].n.name, ttk: sorted[0].ttk },
      slowest: { name: sorted[sorted.length - 1].n.name, ttk: sorted[sorted.length - 1].ttk },
      unkillable: rows.length - finite.length,
      approach: distance === undefined && reach > 0 && median(rows.map((r) => r.n.orbit)) > reach,
      limits: [...new Set(rows.flatMap((r) => [...r.limits]))],
      typical: {
        hp: median(rows.map((r) => r.n.hp[0] + r.n.hp[1] + r.n.hp[2])),
        sig: median(rows.map((r) => r.n.sig)),
        speed: median(rows.map((r) => r.n.speed)),
        orbit: median(rows.map((r) => r.dist))
      }
    })
  }
  const room = classes.reduce((s, c) => s + c.ttkMedian * ROOM[c.cls as NpcClass], 0)
  return {
    faction,
    paperDps: stats.offense.totalDps,
    classes,
    room: { composition: ROOM, seconds: room },
    weaponReach: reach,
    note: 'Sustained DPS without reload pauses, travel between targets or missile flight time. Each NPC orbits at its cruise speed at its orbit distance, or closer when the fit\'s weapons reach less far (the pilot flies in: "approach" marks classes that orbit beyond the weapons). NPC self-repairs are counted. For comparing fits, not a stopwatch.'
  }
}
