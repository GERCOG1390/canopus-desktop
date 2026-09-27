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
  kind: 'turret' | 'missile' | 'drone' | 'smartbomb'
  count: number
  volley: number
  dps: number
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
}

export interface ModuleResult {
  index: number
  cpu: number
  power: number
  capPerSecond: number
  cycle: number
  /** Problems that prevent fitting/onlining this module. */
  problems: string[]
  optimal?: number
  falloff?: number
}

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
}

export interface SavedFit extends FitSpec {
  id: string
  updated: string
}
