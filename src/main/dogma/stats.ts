import type { FitSpec, FitStats, LayerStats, ModuleResult, SkillSource, Slot, WeaponStats, TacticalModule } from '../../shared/fit'
import type { SdeDb } from '../../shared/sde'
import { Dogma, shipModes, type Item } from './engine'

const A = {
  mass: 4,
  hp: 9,
  powerOutput: 11,
  lowSlots: 12,
  medSlots: 13,
  hiSlots: 14,
  power: 30,
  maxVelocity: 37,
  capacity: 38,
  cpuOutput: 48,
  cpu: 50,
  speed: 51,
  maxRange: 54,
  rechargeRate: 55,
  damageMultiplier: 64,
  shieldBonus: 68,
  agility: 70,
  maxTargetRange: 76,
  structureDamageAmount: 83,
  armorDamageAmount: 84,
  launcherSlotsLeft: 101,
  turretSlotsLeft: 102,
  emDamage: 114,
  explosiveDamage: 116,
  kineticDamage: 117,
  thermalDamage: 118,
  falloff: 158,
  trackingSpeed: 160,
  volume: 161,
  maxLockedTargets: 192,
  missileDamageMultiplier: 212,
  shieldCapacity: 263,
  armorHP: 265,
  explosionDelay: 281,
  droneCapacity: 283,
  maxActiveDrones: 352,
  shieldRechargeRate: 479,
  capacitorCapacity: 482,
  signatureRadius: 552,
  scanResolution: 564,
  warpSpeedMultiplier: 600,
  explosionVelocity: 653,
  explosionRadius: 654,
  upgradeCapacity: 1132,
  rigSlots: 1137,
  upgradeCost: 1153,
  droneBandwidth: 1271,
  droneBandwidthUsed: 1272,
  baseWarpSpeed: 1281,
  maxSubSystems: 1367,
  maxGroupFitted: 1544,
  rigSize: 1547,
  maxGroupActive: 763,
  aoeDamageReductionFactor: 1353,
  reloadTime: 1795,
  crystalsGetDamaged: 786,
  capacitorBonus: 67
}

const RESONANCE = {
  shield: [271, 274, 273, 272],
  armor: [267, 270, 269, 268],
  hull: [113, 110, 109, 111]
} as const

const SENSORS: [number, string][] = [
  [208, 'Радар'],
  [209, 'Ладар'],
  [210, 'Магнитометрия'],
  [211, 'Гравиметрия']
]

const CAN_FIT_GROUP = [1298, 1299, 1300, 1872, 1879, 1880, 1881, 2065, 2396, 2476, 2477, 2478, 2479, 2480, 2481, 2482, 2483, 2484]
const CAN_FIT_TYPE = [1302, 1303, 1304, 1305, 1944, 2103, 2463, 2486, 2487, 2488, 2758]

const EFFECT = { turretFitted: 42, launcherFitted: 40, targetAttack: 10, projectileFired: 34, useMissiles: 101, disintegrator: 6995, vorton: 8037, smartbomb: 38 }
/** Ancillary armor repairers: repair multiplier with nanite paste loaded; disintegrator spool-up */
const ATTR_CHARGED_ARMOR_MULT = 1886
const ATTR_SPOOL_MAX = 2734
const ATTR_EMP_RANGE = 99
const ATTR_AOE_VELOCITY = 653
const ATTR_AOE_CLOUD = 654
const ATTR_AOE_DRF = 1353

const ATTR_FITS_TO_SHIP_TYPE = 1380
const ATTR_SUBSYSTEM_SLOT = 1366
const subsystemKindsCache = new WeakMap<SdeDb, Map<number, number>>()

/**
 * Subsystem slots of a T3 hull: one per kind of subsystem made for it (core, defensive, offensive,
 * propulsion). The hulls' own maxSubSystems attribute still says 5 from before the Electronics
 * subsystems were removed; the game shows 4.
 */
export function subsystemSlots(db: SdeDb, shipTypeId: number): number {
  let byShip = subsystemKindsCache.get(db)
  if (!byShip) {
    const kinds = new Map<number, Set<number>>()
    for (const [id, dg] of Object.entries(db.dogma)) {
      const ship = dg.a[ATTR_FITS_TO_SHIP_TYPE]
      const slot = dg.a[ATTR_SUBSYSTEM_SLOT]
      if (!ship || !slot || !db.types[Number(id)]?.pub) continue
      const set = kinds.get(ship) ?? new Set<number>()
      set.add(slot)
      kinds.set(ship, set)
    }
    byShip = new Map([...kinds].map(([ship, set]) => [ship, set.size]))
    subsystemKindsCache.set(db, byShip)
  }
  return byShip.get(shipTypeId) ?? 0
}

export function calculate(db: SdeDb, spec: FitSpec, skills: SkillSource, extraShipAttrs: number[] = []): FitStats {
  const dogma = new Dogma(db, spec.shipTypeId, skills)
  spec.modules.forEach((m, i) => dogma.addModule(m.typeId, m.slot, m.state, m.chargeTypeId, i))
  spec.drones.forEach((d, i) => dogma.addDrone(d.typeId, d.count, Math.min(d.active, d.count), i))
  spec.implants.forEach((id) => dogma.addImplant(id))
  // Tactical destroyers always fly in a mode: the chosen one, else Defense.
  const mode = spec.mode ?? shipModes(db, spec.shipTypeId)[0]?.id
  if (mode) dogma.setMode(mode)
  if (spec.environment) dogma.setEnvironment(spec.environment)
  dogma.link()

  const ship = dogma.ship
  const a = (item: Item, attr: number) => dogma.attr(item, attr)
  const online = (m: Item) => m.state !== 'offline'
  const activeState = (m: Item) => m.state === 'active' || m.state === 'overload'
  const problems: string[] = []

  // ---------- Fitting resources ----------
  const slots: Record<Slot, number> = {
    hi: a(ship, A.hiSlots),
    med: a(ship, A.medSlots),
    lo: a(ship, A.lowSlots),
    rig: a(ship, A.rigSlots),
    sub: a(ship, A.maxSubSystems) > 0 ? Math.min(a(ship, A.maxSubSystems), subsystemSlots(db, spec.shipTypeId) || a(ship, A.maxSubSystems)) : 0
  }
  const hasEffect = (m: Item, e: number) => m.effects.includes(e)
  const cpuUsed = dogma.modules.filter(online).reduce((s, m) => s + a(m, A.cpu), 0)
  const powerUsed = dogma.modules.filter(online).reduce((s, m) => s + a(m, A.power), 0)
  const calibrationUsed = dogma.modules.filter((m) => m.slot === 'rig').reduce((s, m) => s + a(m, A.upgradeCost), 0)
  const turretsUsed = dogma.modules.filter((m) => hasEffect(m, EFFECT.turretFitted)).length
  const launchersUsed = dogma.modules.filter((m) => hasEffect(m, EFFECT.launcherFitted)).length
  const droneVolume = dogma.drones.reduce((s, d) => s + (db.types[d.typeId]?.vol ?? 0) * (d.count ?? 0), 0)
  const bandwidthUsed = dogma.drones.reduce((s, d) => s + a(d, A.droneBandwidthUsed) * (d.active ?? 0), 0)
  const activeDrones = dogma.drones.reduce((s, d) => s + (d.active ?? 0), 0)

  const res = {
    cpu: { used: cpuUsed, total: a(ship, A.cpuOutput) },
    power: { used: powerUsed, total: a(ship, A.powerOutput) },
    calibration: { used: calibrationUsed, total: a(ship, A.upgradeCapacity) },
    turrets: { used: turretsUsed, total: a(ship, A.turretSlotsLeft) },
    launchers: { used: launchersUsed, total: a(ship, A.launcherSlotsLeft) },
    droneBay: { used: droneVolume, total: a(ship, A.droneCapacity) },
    droneBandwidth: { used: bandwidthUsed, total: a(ship, A.droneBandwidth) }
  }
  const maxActiveDrones = a(dogma.char, A.maxActiveDrones)

  for (const slot of ['hi', 'med', 'lo', 'rig', 'sub'] as Slot[]) {
    const n = dogma.modules.filter((m) => m.slot === slot).length
    if (n > slots[slot]) problems.push(`Слишком много модулей в слотах «${slot}»: ${n} из ${slots[slot]}`)
  }
  if (res.cpu.used > res.cpu.total + 1e-6) problems.push('Не хватает CPU')
  if (res.power.used > res.power.total + 1e-6) problems.push('Не хватает мощности реактора (PG)')
  if (res.calibration.used > res.calibration.total + 1e-6) problems.push('Не хватает калибровки для ригов')
  if (turretsUsed > res.turrets.total) problems.push('Не хватает точек монтажа турелей')
  if (launchersUsed > res.launchers.total) problems.push('Не хватает точек монтажа пусковых установок')
  if (droneVolume > res.droneBay.total + 1e-6) problems.push('Дроны не помещаются в отсек')
  if (bandwidthUsed > res.droneBandwidth.total + 1e-6) problems.push('Не хватает пропускной способности для дронов')
  if (activeDrones > maxActiveDrones) problems.push(`Можно запустить не больше ${maxActiveDrones} дронов`)

  // ---------- Per-module checks ----------
  const shipType = db.types[spec.shipTypeId]
  const moduleResults: ModuleResult[] = dogma.modules.map((m) => {
    const p: string[] = []
    const base = m.base
    const groups = CAN_FIT_GROUP.map((x) => base[x]).filter(Boolean)
    const types = CAN_FIT_TYPE.map((x) => base[x]).filter(Boolean)
    if ((groups.length || types.length) && !groups.includes(shipType?.g ?? -1) && !types.includes(spec.shipTypeId)) {
      p.push('Нельзя установить на этот корабль')
    }
    if (m.slot === 'rig' && base[A.rigSize] && a(ship, A.rigSize) && base[A.rigSize] !== a(ship, A.rigSize)) p.push('Неподходящий размер рига')
    const maxFitted = base[A.maxGroupFitted]
    if (maxFitted && dogma.modules.filter((x) => x.group === m.group).length > maxFitted) p.push(`Можно установить не больше ${maxFitted} модулей этой группы`)
    const maxActive = base[A.maxGroupActive]
    if (maxActive && activeState(m) && dogma.modules.filter((x) => x.group === m.group && activeState(x)).length > maxActive) {
      p.push(`Активным может быть не больше ${maxActive} модулей этой группы`)
    }
    const { cycle, capPerSecond, occasional } = cycleAndCap(dogma, m)
    return {
      index: m.index!,
      occasional: occasional || undefined,
      cpu: a(m, A.cpu),
      power: a(m, A.power),
      cycle,
      capPerSecond: activeState(m) ? capPerSecond : 0,
      problems: p,
      optimal: a(m, A.maxRange) || undefined,
      falloff: a(m, A.falloff) || undefined,
      tactical: tacticalOf(dogma, m)
    }
  })
  moduleResults.forEach((r) => r.problems.forEach((p) => problems.push(`${db.types[spec.modules[r.index].typeId]?.n[0]}: ${p}`)))

  // ---------- Defense ----------
  const layer = (hpAttr: number, resonances: readonly number[]): LayerStats => {
    const hp = a(ship, hpAttr)
    const r = resonances.map((x) => a(ship, x)) as [number, number, number, number]
    const avg = r.reduce((s, x) => s + x, 0) / 4
    return { hp, resist: r.map((x) => 1 - x) as LayerStats['resist'], ehp: avg > 0 ? hp / avg : hp }
  }
  const shield = layer(A.shieldCapacity, RESONANCE.shield)
  const armor = layer(A.armorHP, RESONANCE.armor)
  const hull = layer(A.hp, RESONANCE.hull)
  const shieldRechargeSec = a(ship, A.shieldRechargeRate) / 1000

  let shieldBoost = 0
  let armorRepair = 0
  let hullRepair = 0
  for (const m of dogma.modules.filter(activeState)) {
    const e = defaultEffectName(dogma, m)
    const { cycle } = cycleAndCap(dogma, m)
    if (!cycle) continue
    if (e === 'shieldBoosting' || e === 'fueledShieldBoosting') shieldBoost += a(m, A.shieldBonus) / cycle
    if (e === 'armorRepair') armorRepair += a(m, A.armorDamageAmount) / cycle
    // Ancillary armor repairers repair three times as much with nanite paste loaded.
    if (e === 'fueledArmorRepair') armorRepair += (a(m, A.armorDamageAmount) * (m.other ? a(m, ATTR_CHARGED_ARMOR_MULT) || 1 : 1)) / cycle
    if (e === 'structureRepair') hullRepair += a(m, A.structureDamageAmount) / cycle
  }
  const avgRes = (l: LayerStats) => 1 - l.resist.reduce((s, x) => s + x, 0) / 4
  const activeTankEhp = shieldBoost / (avgRes(shield) || 1) + armorRepair / (avgRes(armor) || 1) + hullRepair / (avgRes(hull) || 1)

  // ---------- Capacitor ----------
  const capacity = a(ship, A.capacitorCapacity)
  const rechargeSec = a(ship, A.rechargeRate) / 1000
  const usePerSecond = moduleResults.reduce((s, r) => s + r.capPerSecond, 0)
  // Each active module takes its whole cost when it cycles, like the game (and Pyfa) count it.
  const drains = moduleResults.filter((r) => r.capPerSecond && r.cycle).map((r) => ({ need: r.capPerSecond * r.cycle, cycle: r.cycle, occasional: r.occasional }))
  const capacitor = capacitorStability(capacity, rechargeSec, drains)

  // ---------- Offense ----------
  const weapons: WeaponStats[] = []
  const dmgAttrs = [A.emDamage, A.thermalDamage, A.kineticDamage, A.explosiveDamage]
  /**
   * DPS with reloads: the weapon fires a full load (module capacity / charge volume), then reloads.
   * Frequency crystals are not used up, so lasers never stop to reload.
   */
  const withReload = (m: Item, charge: Item, volley: number, cycle: number): number => {
    const cap = db.types[m.typeId]?.cap ?? 0
    const vol = db.types[charge.typeId]?.vol ?? 0
    const crystal = db.dogma[charge.typeId]?.a[A.crystalsGetDamaged] !== undefined
    const shots = vol > 0 ? Math.floor(cap / vol + 1e-9) : 0
    const reload = a(m, A.reloadTime) / 1000
    if (crystal || shots <= 0 || !reload) return volley / cycle
    return (volley * shots) / (shots * cycle + reload)
  }
  for (const m of dogma.modules.filter(activeState)) {
    // Smartbombs: damage of their own, every cycle, to everything within their radius.
    if (hasEffect(m, EFFECT.smartbomb)) {
      const cycle = a(m, 73) / 1000
      const damage = dmgAttrs.map((x) => a(m, x)) as WeaponStats['damage']
      const volley = damage.reduce((s, x) => s + x, 0)
      if (cycle && volley)
        weapons.push({ moduleIndex: m.index!, typeId: m.typeId, kind: 'smartbomb', count: 1, volley, dps: volley / cycle, dpsReload: volley / cycle, damage, cycle, optimal: a(m, ATTR_EMP_RANGE) })
      continue
    }
    const charge = m.other
    const isDisintegrator = hasEffect(m, EFFECT.disintegrator)
    const isTurret = hasEffect(m, EFFECT.targetAttack) || hasEffect(m, EFFECT.projectileFired) || isDisintegrator
    const isMissile = hasEffect(m, EFFECT.useMissiles)
    const isVorton = hasEffect(m, EFFECT.vorton)
    if (!charge || (!isTurret && !isMissile && !isVorton)) continue
    const cycle = a(m, A.speed) / 1000
    if (!cycle) continue
    if (isTurret) {
      const mult = a(m, A.damageMultiplier)
      const damage = dmgAttrs.map((x) => a(charge, x) * mult) as WeaponStats['damage']
      const volley = damage.reduce((s, x) => s + x, 0)
      weapons.push({
        moduleIndex: m.index!,
        typeId: m.typeId,
        chargeTypeId: charge.typeId,
        kind: 'turret',
        count: 1,
        volley,
        dps: volley / cycle,
        dpsReload: withReload(m, charge, volley, cycle),
        damage,
        cycle,
        optimal: a(m, A.maxRange),
        falloff: a(m, A.falloff),
        tracking: a(m, A.trackingSpeed),
        // The game's fitting window shows disintegrators before they spool up; the bonus comes with time on target.
        spoolMax: isDisintegrator ? a(m, ATTR_SPOOL_MAX) || undefined : undefined
      })
    } else if (isVorton) {
      // Vorton projectors: charge damage x the projector's multiplier, applied like missiles (explosion radius and speed).
      const damage = dmgAttrs.map((x) => a(charge, x) * a(m, A.damageMultiplier)) as WeaponStats['damage']
      const volley = damage.reduce((s, x) => s + x, 0)
      weapons.push({
        moduleIndex: m.index!,
        typeId: m.typeId,
        chargeTypeId: charge.typeId,
        kind: 'vorton',
        count: 1,
        volley,
        dps: volley / cycle,
        dpsReload: withReload(m, charge, volley, cycle),
        damage,
        cycle,
        optimal: a(m, A.maxRange),
        explosionRadius: a(m, ATTR_AOE_CLOUD),
        explosionVelocity: a(m, ATTR_AOE_VELOCITY),
        drf: a(m, ATTR_AOE_DRF)
      })
    } else {
      const mult = a(dogma.char, A.missileDamageMultiplier) || 1
      const damage = dmgAttrs.map((x) => a(charge, x) * mult) as WeaponStats['damage']
      const volley = damage.reduce((s, x) => s + x, 0)
      weapons.push({
        moduleIndex: m.index!,
        typeId: m.typeId,
        chargeTypeId: charge.typeId,
        kind: 'missile',
        count: 1,
        volley,
        dps: volley / cycle,
        dpsReload: withReload(m, charge, volley, cycle),
        damage,
        cycle,
        optimal: (a(charge, A.maxVelocity) * a(charge, A.explosionDelay)) / 1000,
        explosionRadius: a(charge, A.explosionRadius),
        explosionVelocity: a(charge, A.explosionVelocity),
        drf: a(charge, A.aoeDamageReductionFactor),
        missileVelocity: a(charge, A.maxVelocity)
      })
    }
  }
  for (const d of dogma.drones) {
    if (!d.active) continue
    const cycle = a(d, A.speed) / 1000
    const mult = a(d, A.damageMultiplier)
    const damage = dmgAttrs.map((x) => a(d, x) * mult * (d.active ?? 0)) as WeaponStats['damage']
    const volley = damage.reduce((s, x) => s + x, 0)
    if (!cycle || !volley) continue
    weapons.push({
      moduleIndex: d.index!,
      typeId: d.typeId,
      kind: 'drone',
      count: d.active ?? 0,
      volley,
      dps: volley / cycle,
      dpsReload: volley / cycle,
      damage,
      cycle,
      optimal: a(d, A.maxRange),
      falloff: a(d, A.falloff),
      tracking: a(d, A.trackingSpeed),
      speed: a(d, A.maxVelocity)
    })
  }
  const sumDps = (kind: WeaponStats['kind']) => weapons.filter((w) => w.kind === kind).reduce((s, w) => s + w.dps, 0)

  // ---------- Navigation & targeting ----------
  const mass = a(ship, A.mass)
  const agility = a(ship, A.agility)
  const sensor = SENSORS.map(([id, name]) => [a(ship, id), name] as [number, string]).sort((x, y) => y[0] - x[0])[0]

  const shipAttrs: Record<number, number> = {}
  for (const id of extraShipAttrs) shipAttrs[id] = a(ship, id)

  return {
    ship: { slots, ...res, maxActiveDrones, cargo: a(ship, A.capacity) },
    defense: {
      shield,
      armor,
      hull,
      ehp: shield.ehp + armor.ehp + hull.ehp,
      hp: shield.hp + armor.hp + hull.hp,
      shieldRechargeSec,
      passiveShieldRegen: shieldRechargeSec ? (2.5 * shield.hp) / shieldRechargeSec : 0,
      shieldBoost,
      armorRepair,
      hullRepair,
      activeTankEhp
    },
    capacitor: { capacity, rechargeSec, usePerSecond, ...capacitor },
    offense: {
      weapons,
      totalDps: weapons.reduce((s, w) => s + w.dps, 0),
      totalDpsReload: weapons.reduce((s, w) => s + w.dpsReload, 0),
      totalVolley: weapons.reduce((s, w) => s + w.volley, 0),
      turretDps: sumDps('turret'),
      missileDps: sumDps('missile'),
      droneDps: sumDps('drone')
    },
    navigation: {
      maxVelocity: a(ship, A.maxVelocity),
      agility,
      mass,
      alignSec: (Math.log(4) * agility * mass) / 1_000_000,
      warpSpeed: a(ship, A.warpSpeedMultiplier) * (a(ship, A.baseWarpSpeed) || 1),
      signatureRadius: a(ship, A.signatureRadius)
    },
    targeting: {
      maxRange: a(ship, A.maxTargetRange),
      scanResolution: a(ship, A.scanResolution),
      maxTargets: Math.min(a(ship, A.maxLockedTargets), a(dogma.char, A.maxLockedTargets) || Infinity),
      sensorStrength: sensor[0],
      sensorType: sensor[1]
    },
    modules: moduleResults,
    problems,
    shipAttrs
  }
}

const defaultEffectName = (dogma: Dogma, m: Item): string | undefined => dogma.defaultEffect(m)?.name

/** speedFactor, signatureRadiusBonus, maxRange, warpScrambleStrength, falloffEffectiveness */
const TA = { speedFactor: 20, sigBonus: 554, range: 54, scramStrength: 105, falloffEff: 2044 }

function tacticalOf(dogma: Dogma, m: Item): TacticalModule | undefined {
  const a = (id: number) => dogma.attr(m, id)
  switch (defaultEffectName(dogma, m)) {
    case 'remoteWebifierFalloff':
      return { kind: 'web', strength: a(TA.speedFactor), range: a(TA.range), falloff: a(TA.falloffEff) }
    case 'remoteTargetPaintFalloff':
      return { kind: 'paint', strength: a(TA.sigBonus), range: a(TA.range), falloff: a(TA.falloffEff) }
    case 'warpScrambleBlockMWDWithNPCEffect':
      return { kind: 'scram', strength: a(TA.scramStrength), range: a(TA.range) }
    case 'warpDisrupt':
      return { kind: 'point', strength: a(TA.scramStrength), range: a(TA.range) }
    case 'moduleBonusMicrowarpdrive':
      return { kind: 'mwd' }
    case 'moduleBonusAfterburner':
      return { kind: 'ab' }
  }
  return undefined
}

/** moduleReactivationDelay, ms */
const REACTIVATION_DELAY = 669

function cycleAndCap(dogma: Dogma, m: Item): { cycle: number; capPerSecond: number; occasional?: boolean } {
  const e = dogma.defaultEffect(m)
  if (!e?.dur) return { cycle: 0, capPerSecond: 0 }
  const cycle = dogma.attr(m, e.dur) / 1000
  if (!cycle) return { cycle: 0, capPerSecond: 0 }
  let cap = e.dis ? dogma.attr(m, e.dis) : 0
  // Capacitor boosters inject charge instead of using it.
  if (e.name === 'powerBooster' && m.other) cap -= dogma.attr(m.other, A.capacitorBonus)
  // Ancillary shield boosters burn cap booster charges instead of capacitor while they have them.
  if (e.name === 'fueledShieldBoosting' && m.other) cap = 0
  // Modules with a reactivation delay (micro jump drives: 180 s) can only start again after it.
  const delay = dogma.attr(m, REACTIVATION_DELAY) / 1000
  const every = cycle + delay
  return { cycle: every, capPerSecond: cap / every, occasional: delay > 0 }
}

/**
 * EVE capacitor: regeneration dC/dt = (10·Cmax/τ)·(√(C/Cmax) − C/Cmax), which between two moments
 * solves to C(t) = Cmax·(1 + (√(C0/Cmax) − 1)·e^(−5t/τ))². Modules take their whole cost at the
 * start of each cycle. Events are simulated in order: the capacitor runs out when a module can't
 * pay for its next cycle; surviving six hours counts as stable, at the lowest level reached
 * after the first hour (just before an activation, as the game shows it).
 */
function capacitorStability(capacity: number, rechargeSec: number, drains: { need: number; cycle: number; occasional?: boolean }[]): { peakRecharge: number; stable: boolean; stableLevel?: number; lastsSec?: number } {
  const peakRecharge = rechargeSec ? (2.5 * capacity) / rechargeSec : 0
  // Occasional modules (micro jump drives) are spread over their window as the game's fitting window
  // averages them, instead of one big bite at the start of every window.
  const mods = drains
    .filter((d) => d.need && d.cycle > 0)
    .map((d) => {
      if (!d.occasional) return d
      const parts = Math.max(1, Math.ceil(d.cycle / 10))
      return { ...d, need: d.need / parts, cycle: d.cycle / parts }
    })
  if (!mods.some((d) => d.need > 0) || !capacity || !rechargeSec) return { peakRecharge, stable: true, stableLevel: 1 }
  const regen = (c: number, dt: number) => {
    const r = 1 + (Math.sqrt(Math.max(0, c) / capacity) - 1) * Math.exp((-5 * dt) / rechargeSec)
    return capacity * r * r
  }
  const LIMIT = 6 * 3600
  const next = mods.map(() => 0)
  let c = capacity
  let t = 0
  let low = capacity
  for (let guard = 0; guard < 2_000_000; guard++) {
    const at = Math.min(...next)
    if (at > LIMIT) break
    c = regen(c, at - t)
    t = at
    for (let i = 0; i < mods.length; i++) {
      if (next[i] > t + 1e-9) continue
      if (t >= 3600) low = Math.min(low, c)
      if (mods[i].need > 0 && c < mods[i].need) {
        // A micro jump drive that can't jump yet waits; the capacitor is out when the modules that run all the time can't cycle.
        if (mods[i].occasional) {
          next[i] += mods[i].cycle
          continue
        }
        return { peakRecharge, stable: false, lastsSec: t }
      }
      // Capacitor boosters (negative need) can't fill past the maximum.
      c = Math.min(capacity, c - mods[i].need)
      next[i] += mods[i].cycle
    }
  }
  // The level shown is the game's own: where the average drain meets the recharge curve,
  // 10·C/T·(√s − s) = drain. The simulation's lowest dip after activations sits a few percent lower.
  const drain = mods.reduce((sum, d) => sum + d.need / d.cycle, 0)
  const k = 1 - (4 * drain * rechargeSec) / (10 * capacity)
  const level = drain <= 0 ? 1 : k >= 0 ? 0.25 * (1 + Math.sqrt(k)) ** 2 : low / capacity
  return { peakRecharge, stable: true, stableLevel: level }
}
