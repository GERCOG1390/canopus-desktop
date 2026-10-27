// Abyssal Deadspace planner: the fit in a filament's weather (the weather celestial's warfare buffs through
// the dogma engine, as the game and Pyfa apply them) against every abyssal NPC of a faction, also in that
// weather: time to kill each one, and the DPS, neutralizing and e-war it throws at the fit's tank.
// The SDE has no room spawn tables, so it is per NPC, not per room.

import type { AbyssFaction, AbyssFactionResult, AbyssFitSide, AbyssNpc, AbyssReport, AbyssWeather } from '../../shared/abyss'
import { ABYSS_FACTIONS, WEATHER_CELESTIAL, WEATHER_HOLE } from '../../shared/abyss'
import type { FitSpec, FitStats, SkillSource } from '../../shared/fit'
import { sdeForDogma } from '../sde'
import { application } from './combat'
import { calculateFit } from './index'

const NPC_GROUPS = new Set([1982, 1997])

const FACTION_NAME: [AbyssFaction, RegExp][] = [
  ['triglavian', /Damavik|Vedmak|Leshak|Kikimora|Drekavac|Rodiva|Vila Swarmer/],
  ['drifter', /^Drifter |^Ephialtes /],
  ['sleeper', /^Lucid /],
  ['rogue_drone', /Tessella|Tessera|Abyssal Overmind/],
  ['sansha', /^Devoted /],
  ['angel', /Lucifer/],
  ['edencom', /Disparu Troop/]
]
/** Event and test entities in the same groups (150k HP event bosses, placeholders), not abyssal rooms. */
const NOT_ROOMS = /placeholder|^Battered |^Impaired |^Ruptured |^Dievas |^Tyrannos |^Awoken |^Igniting /

const A = {
  shield: 263,
  armor: 265,
  hull: 9,
  sig: 552,
  cruise: 508,
  maxVelocity: 37,
  orbit: 416,
  combatOrbit: 2786,
  rof: 51,
  damageMult: 64,
  /** em, thermal, kinetic, explosive */
  damage: [114, 118, 117, 116],
  missileType: 507,
  missileMult: 212,
  missileRof: 506,
  spoolMax: 2734,
  neutAmount: 97,
  neutCycle: 2519,
  shieldRes: [271, 274, 273, 272],
  armorRes: [267, 270, 269, 268],
  hullRes: [113, 110, 109, 111],
  reps: [
    [637, 636],
    [2723, 2725],
    [631, 630],
    [2635, 2633]
  ]
}

const EWAR: Record<string, string> = {
  npcBehaviorWebifier: 'web',
  behaviorTargetPainter: 'paint',
  behaviorWarpScramble: 'scram',
  behaviorSensorDampener: 'damp',
  npcBehaviorTrackingDisruptor: 'track',
  npcBehaviorGuidanceDisruptor: 'guide',
  npcBehaviorRemoteArmorRepairer: 'remote',
  npcBehaviorRemoteShieldBooster: 'remote',
  EntityChainLightning: 'chain'
}

interface Target {
  id: number
  name: string
  faction: AbyssFaction
  hp: [number, number, number]
  res: [number[], number[], number[]]
  sig: number
  speed: number
  orbit: number
  /** shield, armor HP/s */
  reps: [number, number]
  types: [number, number, number, number]
  neut: number
  ewar: string[]
}

function factionOf(name: string): AbyssFaction | null {
  if (NOT_ROOMS.test(name)) return null
  return FACTION_NAME.find(([, re]) => re.test(name))?.[0] ?? null
}

/** Every abyssal NPC with the weather applied to it too (the resist hole and the HP bonus hit both sides). */
function abyssNpcs(weather: AbyssWeather, strength: number): Target[] {
  const d = sdeForDogma()
  const hole = WEATHER_HOLE[weather]
  const out: Target[] = []
  for (const t of Object.values(d.types)) {
    if (!NPC_GROUPS.has(t.g)) continue
    const faction = factionOf(t.n[0])
    if (!faction) continue
    const dg = d.dogma[t.id] ?? { a: {}, e: [] }
    const a = dg.a
    const effects = dg.e.map((e) => d.effects[e]?.name ?? '')
    const hp: [number, number, number] = [(a[A.shield] ?? 0) * (weather === 'gamma' ? 1.5 : 1), (a[A.armor] ?? 0) * (weather === 'firestorm' ? 1.5 : 1), a[A.hull] ?? 0]
    if (hp[0] + hp[1] + hp[2] <= 0) continue
    // A resistance can't go below 0% (resonance capped at 1).
    const res = (ids: number[]) => ids.map((i, k) => Math.min(1, (a[i] ?? 1) * (k === hole ? 1 + strength / 100 : 1)))
    const perSec = (amount?: number, ms?: number) => (amount && ms ? amount / (ms / 1000) : 0)
    const types: [number, number, number, number] = [0, 0, 0, 0]
    const turret = effects.includes('targetAttack') || effects.includes('targetDisintegratorAttack')
    if (turret && a[A.rof]) {
      // Disintegrators counted fully spooled: what a long fight settles at.
      const mult = (a[A.damageMult] ?? 1) * (effects.includes('targetDisintegratorAttack') ? 1 + (a[A.spoolMax] ?? 0) : 1)
      A.damage.forEach((id, k) => (types[k] += ((a[id] ?? 0) * mult) / (a[A.rof] / 1000)))
    }
    const missile = a[A.missileType]
    if (effects.includes('missileLaunchingForEntity') && missile && a[A.missileRof]) {
      const m = d.dogma[missile]?.a ?? {}
      A.damage.forEach((id, k) => (types[k] += ((m[id] ?? 0) * (a[A.missileMult] ?? 1)) / (a[A.missileRof] / 1000)))
    }
    out.push({
      id: t.id,
      name: t.n[0],
      faction,
      hp,
      res: [res(A.shieldRes), res(A.armorRes), res(A.hullRes)],
      sig: a[A.sig] ?? 100,
      speed: a[A.cruise] || a[A.maxVelocity] || 0,
      orbit: a[A.combatOrbit] || a[A.orbit] || 5000,
      reps: [perSec(a[A.reps[0][0]], a[A.reps[0][1]]) + perSec(a[A.reps[1][0]], a[A.reps[1][1]]), perSec(a[A.reps[2][0]], a[A.reps[2][1]]) + perSec(a[A.reps[3][0]], a[A.reps[3][1]])],
      types,
      neut: effects.includes('npcBehaviorEnergyNeutralizer') ? perSec(a[A.neutAmount], a[A.neutCycle]) : 0,
      ewar: [...new Set(effects.map((e) => EWAR[e]).filter(Boolean))]
    })
  }
  return out
}

/** The layer the fit tanks on: the one it repairs, else the one with the most effective HP. */
function tankLayer(s: FitStats): 'shield' | 'armor' | 'hull' {
  const d = s.defense
  if (d.shieldBoost > 0 || d.armorRepair > 0 || d.hullRepair > 0) {
    const best = Math.max(d.shieldBoost, d.armorRepair, d.hullRepair)
    return best === d.shieldBoost ? 'shield' : best === d.armorRepair ? 'armor' : 'hull'
  }
  return d.shield.ehp >= d.armor.ehp && d.shield.ehp >= d.hull.ehp ? 'shield' : d.armor.ehp >= d.hull.ehp ? 'armor' : 'hull'
}

const reachOf = (s: FitStats) =>
  Math.max(0, ...s.offense.weapons.map((w) => (w.kind === 'turret' ? (w.optimal ?? 0) + (w.falloff ?? 0) * 0.5 : w.kind === 'missile' || w.kind === 'vorton' ? (w.optimal ?? 0) : 0)))

function side(s: FitStats, layer: 'shield' | 'armor' | 'hull'): AbyssFitSide {
  const d = s.defense
  return {
    dps: s.offense.totalDps,
    ehp: d.ehp,
    resist: d[layer].resist,
    repair: layer === 'shield' ? d.shieldBoost + d.passiveShieldRegen : layer === 'armor' ? d.armorRepair : d.hullRepair,
    capStable: s.capacitor.stable,
    capLevel: s.capacitor.stableLevel,
    capLasts: s.capacitor.lastsSec,
    speed: s.navigation.maxVelocity,
    reach: reachOf(s)
  }
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

export function abyssPlan(spec: FitSpec, skills: SkillSource, weather: AbyssWeather, strength: number, only?: AbyssFaction): AbyssReport {
  const normalStats = calculateFit({ ...spec, environment: undefined }, skills)
  const stats = calculateFit({ ...spec, environment: WEATHER_CELESTIAL[weather][strength] }, skills)
  // The layer comes from the fit in the weather: the HP bonus can move a buffer fit to the other layer.
  const layer = tankLayer(stats)
  const fit = side(stats, layer)
  const weapons = stats.offense.weapons
  const resonance = fit.resist.map((r) => 1 - r)
  const factions: AbyssFactionResult[] = []
  const all = abyssNpcs(weather, strength)
  for (const faction of ABYSS_FACTIONS) {
    if (only && faction !== only) continue
    const npcs: AbyssNpc[] = all
      .filter((n) => n.faction === faction)
      .map((n) => {
        // The pilot fights inside their weapons' reach; NPCs orbit at their combat range when they can.
        const dist = fit.reach > 0 ? Math.min(n.orbit, fit.reach * 0.95) : n.orbit
        const geo = { distance: dist, transversal: n.speed, targetSpeed: n.speed, targetSig: n.sig, receding: 0 }
        const byType = [0, 0, 0, 0]
        let paper = 0
        let applied = 0
        for (const w of weapons) {
          const { factor } = application(w, geo)
          paper += w.dps
          applied += w.dps * factor
          w.damage.forEach((x, k) => (byType[k] += (x / (w.cycle || 1)) * factor))
        }
        const through = (layerIdx: number) => byType.reduce((s, x, k) => s + x * n.res[layerIdx][k], 0)
        const eff = [through(0) - n.reps[0], through(1) - n.reps[1], through(2)]
        const ttk = n.hp.reduce((s, hp, i) => (hp <= 0 ? s : eff[i] > 0 ? s + hp / eff[i] : Infinity), 0)
        const dps = n.types.reduce((s, x) => s + x, 0)
        return {
          id: n.id,
          name: n.name,
          hp: n.hp[0] + n.hp[1] + n.hp[2],
          sig: n.sig,
          ttk,
          application: paper ? applied / paper : 0,
          dps,
          taken: n.types.reduce((s, x, k) => s + x * resonance[k], 0),
          types: n.types,
          neut: n.neut,
          ewar: n.ewar
        }
      })
      .sort((a, b) => b.taken - a.taken)
    if (!npcs.length) continue
    factions.push({ faction, npcs, ttkMedian: median(npcs.map((n) => n.ttk)), worstTaken: Math.max(...npcs.map((n) => n.taken)) })
  }
  return {
    weather,
    strength,
    layer,
    normal: side(normalStats, tankLayer(normalStats)),
    inWeather: fit,
    factions,
    note:
      'Per NPC, not per room: the SDE has no abyssal spawn tables. NPC DPS is on paper (every shot hits, disintegrators fully spooled), "taken" is after the fit\'s resists in the weather on its tank layer. The weather applies to the NPCs too (their resist hole and HP bonus). Kill time: sustained DPS, NPC self-repairs counted, no travel or reload.'
  }
}
