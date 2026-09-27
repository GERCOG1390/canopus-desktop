import type { FitSpec, FitStats, LayerStats, ModuleResult, SkillSource, Slot, WeaponStats } from '../../shared/fit'
import type { SdeDb } from '../../shared/sde'
import { Dogma, type Item } from './engine'

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

const EFFECT = { turretFitted: 42, launcherFitted: 40, targetAttack: 10, projectileFired: 34, useMissiles: 101 }

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
    const { cycle, capPerSecond } = cycleAndCap(dogma, m)
    return {
      index: m.index!,
      cpu: a(m, A.cpu),
      power: a(m, A.power),
      cycle,
      capPerSecond: activeState(m) ? capPerSecond : 0,
      problems: p,
      optimal: a(m, A.maxRange) || undefined,
      falloff: a(m, A.falloff) || undefined
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
    if (e === 'armorRepair' || e === 'fueledArmorRepair') armorRepair += a(m, A.armorDamageAmount) / cycle
    if (e === 'structureRepair') hullRepair += a(m, A.structureDamageAmount) / cycle
  }
  const avgRes = (l: LayerStats) => 1 - l.resist.reduce((s, x) => s + x, 0) / 4
  const activeTankEhp = shieldBoost / (avgRes(shield) || 1) + armorRepair / (avgRes(armor) || 1) + hullRepair / (avgRes(hull) || 1)

  // ---------- Capacitor ----------
  const capacity = a(ship, A.capacitorCapacity)
  const rechargeSec = a(ship, A.rechargeRate) / 1000
  const usePerSecond = moduleResults.reduce((s, r) => s + r.capPerSecond, 0)
  const capacitor = capacitorStability(capacity, rechargeSec, usePerSecond)

  // ---------- Offense ----------
  const weapons: WeaponStats[] = []
  const dmgAttrs = [A.emDamage, A.thermalDamage, A.kineticDamage, A.explosiveDamage]
  for (const m of dogma.modules.filter(activeState)) {
    const charge = m.other
    const isTurret = hasEffect(m, EFFECT.targetAttack) || hasEffect(m, EFFECT.projectileFired)
    const isMissile = hasEffect(m, EFFECT.useMissiles)
    if (!charge || (!isTurret && !isMissile)) continue
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
        damage,
        cycle,
        optimal: a(m, A.maxRange),
        falloff: a(m, A.falloff),
        tracking: a(m, A.trackingSpeed)
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
        damage,
        cycle,
        optimal: (a(charge, A.maxVelocity) * a(charge, A.explosionDelay)) / 1000,
        explosionRadius: a(charge, A.explosionRadius),
        explosionVelocity: a(charge, A.explosionVelocity)
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
      damage,
      cycle,
      optimal: a(d, A.maxRange),
      falloff: a(d, A.falloff),
      tracking: a(d, A.trackingSpeed)
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

function cycleAndCap(dogma: Dogma, m: Item): { cycle: number; capPerSecond: number } {
  const e = dogma.defaultEffect(m)
  if (!e?.dur) return { cycle: 0, capPerSecond: 0 }
  const cycle = dogma.attr(m, e.dur) / 1000
  if (!cycle) return { cycle: 0, capPerSecond: 0 }
  let cap = e.dis ? dogma.attr(m, e.dis) : 0
  // Capacitor boosters inject charge instead of using it.
  if (e.name === 'powerBooster' && m.other) cap -= dogma.attr(m.other, A.capacitorBonus)
  return { cycle, capPerSecond: cap / cycle }
}

/**
 * EVE capacitor regeneration: dC/dt = (10·Cmax/τ)·(√(C/Cmax) − C/Cmax).
 * Stable if the drain fits under that curve; otherwise simulate until empty.
 */
function capacitorStability(capacity: number, rechargeSec: number, use: number): { peakRecharge: number; stable: boolean; stableLevel?: number; lastsSec?: number } {
  const peakRecharge = rechargeSec ? (2.5 * capacity) / rechargeSec : 0
  if (use <= 0 || !capacity || !rechargeSec) return { peakRecharge, stable: true, stableLevel: 1 }
  const k = (use * rechargeSec) / (10 * capacity)
  if (k <= 0.25) {
    const x = (1 + Math.sqrt(1 - 4 * k)) / 2
    return { peakRecharge, stable: true, stableLevel: x * x }
  }
  let c = capacity
  let t = 0
  const dt = 0.5
  while (c > 0 && t < 86_400) {
    const f = c / capacity
    c += ((10 * capacity) / rechargeSec) * (Math.sqrt(f) - f) * dt - use * dt
    t += dt
  }
  return { peakRecharge, stable: false, lastsSec: t }
}
