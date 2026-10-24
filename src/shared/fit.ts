// Fit description sent to the dogma engine, and the stats it returns.

export type Slot = 'hi' | 'med' | 'lo' | 'rig' | 'sub'
export type ModuleState = 'offline' | 'online' | 'active' | 'overload'

export interface FitModule {
  typeId: number
  slot: Slot
  state: ModuleState
  chargeTypeId?: number
}

export interface FitDrone {
  typeId: number
  count: number
  /** How many of them are launched and counted for DPS. */
  active: number
}

export interface FitSpec {
  shipTypeId: number
  name: string
  modules: FitModule[]
  drones: FitDrone[]
  implants: number[]
  cargo?: { typeId: number; qty: number }[]
  /** Tactical destroyer mode (type id); undefined = Defense */
  mode?: number
}

/** Skill levels to fit with: a map of skill → level, or every skill at V. */
export type SkillSource = { mode: 'all5' } | { mode: 'char'; levels: Record<number, number> }

export interface ResourceUse {
  used: number
  total: number
}

export interface LayerStats {
  hp: number
  /** Resistances as fractions 0..1: em, thermal, kinetic, explosive. */
  resist: [number, number, number, number]
  ehp: number
}

export interface WeaponStats {
  moduleIndex: number
  typeId: number
  chargeTypeId?: number
  kind: 'turret' | 'missile' | 'drone' | 'smartbomb' | 'vorton'
  count: number
  volley: number
  dps: number
  /** DPS counting the reload after each full load of charges (equal to dps when there is none) */
  dpsReload: number
  /** em, thermal, kinetic, explosive volley */
  damage: [number, number, number, number]
  cycle: number
  optimal?: number
  falloff?: number
  tracking?: number
  explosionRadius?: number
  explosionVelocity?: number
  /** Missile damage reduction factor (drf) */
  drf?: number
  /** Missile flight speed, m/s (the range is speed × flight time) */
  missileVelocity?: number
  /** Drone speed, m/s */
  speed?: number
  /** Triglavian disintegrators: the damage bonus reached after spooling up (2.125 = +212.5%) */
  spoolMax?: number
}

export interface ModuleResult {
  index: number
  cpu: number
  power: number
  capPerSecond: number
  cycle: number
  /** Problems that prevent fitting/onlining this module. */
  problems: string[]
  /** Used now and then (a reactivation delay, like a micro jump drive), not cycled all the time */
  occasional?: boolean
  optimal?: number
  falloff?: number
  /** What the module does to a target or to its own ship's movement, for the combat simulator */
  tactical?: TacticalModule
}

/** Webs, painters, scrams, points and propulsion, with their strength (skills applied) and reach. */
export type TacticalModule =
  | { kind: 'web' | 'paint'; strength: number; range: number; falloff: number }
  | { kind: 'scram' | 'point'; strength: number; range: number }
  | { kind: 'mwd' | 'ab' }

export interface FitStats {
  ship: {
    slots: Record<Slot, number>
    turrets: ResourceUse
    launchers: ResourceUse
    cpu: ResourceUse
    power: ResourceUse
    calibration: ResourceUse
    droneBay: ResourceUse
    droneBandwidth: ResourceUse
    maxActiveDrones: number
    cargo: number
  }
  defense: {
    shield: LayerStats
    armor: LayerStats
    hull: LayerStats
    ehp: number
    hp: number
    shieldRechargeSec: number
    passiveShieldRegen: number
    /** Active repair per second (HP/s) */
    shieldBoost: number
    armorRepair: number
    hullRepair: number
    /** Effective (resist-weighted) active tank per second */
    activeTankEhp: number
  }
  capacitor: {
    capacity: number
    rechargeSec: number
    peakRecharge: number
    usePerSecond: number
    stable: boolean
    /** Stable level 0..1 when stable */
    stableLevel?: number
    /** Seconds until empty when not stable */
    lastsSec?: number
  }
  offense: {
    weapons: WeaponStats[]
    totalDps: number
    /** With reloads (turrets and launchers; drones don't reload) */
    totalDpsReload: number
    totalVolley: number
    turretDps: number
    missileDps: number
    droneDps: number
  }
  navigation: {
    maxVelocity: number
    agility: number
    mass: number
    alignSec: number
    warpSpeed: number
    signatureRadius: number
  }
  targeting: {
    maxRange: number
    scanResolution: number
    maxTargets: number
    sensorStrength: number
    sensorType: string
  }
  modules: ModuleResult[]
  problems: string[]
  /** Final values of any requested ship attributes */
  shipAttrs: Record<number, number>
}

export interface FittableType {
  id: number
  slot: Slot | 'drone' | 'implant'
  g: number
  mg?: number
  turret?: boolean
  launcher?: boolean
  /** Meta group */
  meta?: number
  /** Can be activated (has a timed active effect) */
  act?: boolean
  /** Can be overheated */
  oh?: boolean
  /** Takes charges */
  charges?: boolean
  /** Emergency module that can't be cycled (e.g. Assault Damage Control): kept online by default */
  burst?: boolean
  /** Subsystem kind (subSystemSlot: core, defensive, offensive, propulsion) */
  ss?: number
  /** Implant slot 1–10 (implantness): one implant per slot */
  is?: number
}

export interface SavedFit extends FitSpec {
  id: string
  updated: string
}

/** The numbers the fit optimizer compares. */
export interface FitMetrics {
  dps: number
  ehp: number
  activeTank: number
  speed: number
  align: number
  lockRange: number
  scanRes: number
  signature: number
  /** Weapons, DPS-weighted: reach (optimal + falloff, missile range), turret tracking, missile explosion radius and speed */
  range: number
  tracking: number
  explosionRadius: number
  explosionVelocity: number
  capStable: boolean
  /** Stable level 0..1, or seconds the capacitor lasts */
  capLevel: number
  capLasts: number
  /** CPU, powergrid and calibration all fit */
  fits: boolean
}

/** All modules (or drones) of one type swapped for another of the same family (T1, T2, faction...). */
export interface FitVariant {
  from: number
  to: number
  kind: 'module' | 'drone'
  count: number
  metrics: FitMetrics
  /** The character lacks a skill for it */
  missingSkills: boolean
}
