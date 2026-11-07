// Compact representation of CCP's Static Data Export as built by src/main/sde/build.ts.
// Localised strings are stored as [english, russian].

export type L10n = [string, string]

export interface SdeType {
  id: number
  n: L10n
  g: number
  pub: boolean
  mg?: number
  meta?: number
  ml?: number
  vol?: number
  pvol?: number
  mass?: number
  cap?: number
  portion?: number
  /** variationParentTypeID */
  vp?: number
  tl?: number
  race?: number
  faction?: number
  price?: number
  icon?: number
  graphic?: number
}

export interface Bonus {
  b?: number
  u?: number
  t: L10n
}

export interface BlueprintActivity {
  time: number
  mat?: [number, number][]
  prod?: [number, number, number?][]
  skills?: [number, number][]
}

export interface DogmaModifier {
  func: string
  domain: string
  attr: number
  src: number
  op: number
  group?: number
  skill?: number
}

export interface DogmaEffect {
  name: string
  cat: number
  dur?: number
  dis?: number
  range?: number
  falloff?: number
  mods?: DogmaModifier[]
}

/** Bumped whenever the DB layout changes, forcing a rebuild from the SDE zip. */
export const SDE_FORMAT = 10

export interface CampaignDef {
  t: L10n
  s: L10n
  faction?: number
  target: number
}

export interface CampaignObjectiveDef {
  campaign: string
  t: L10n
  s: L10n
  target: number
  /** Most progress one pilot can add */
  max?: number
  /** How it is contributed to: CompleteAgentMission, KillNPC, MineOre… */
  method: string
  /** Rewards per progress interval */
  isk?: number
  lp?: number
  standing?: number
  interval?: number
  /** Corporation paying LP / ISK */
  corp?: number
}

export interface SdeDb {
  format: number
  build: number
  releaseDate: string
  types: Record<number, SdeType>
  groups: Record<number, { n: L10n; c: number; pub: boolean }>
  categories: Record<number, { n: L10n; pub: boolean }>
  marketGroups: Record<number, { n: L10n; p?: number; icon?: number }>
  metaGroups: Record<number, L10n>
  attributes: Record<number, { name: string; dn?: L10n; tt?: L10n; u?: number; cat?: number; pub: boolean; high: boolean; def: number; icon?: number; stack: boolean }>
  attrCategories: Record<number, string>
  units: Record<number, L10n>
  effects: Record<number, DogmaEffect>
  /** a: attributes, e: effects, de: default (activatable) effect */
  dogma: Record<number, { a: Record<number, number>; e: number[]; de?: number }>
  bonuses: Record<number, { role?: Bonus[]; misc?: Bonus[]; skills?: [number, Bonus[]][] }>
  blueprints: Record<number, { max: number; act: Record<string, BlueprintActivity> }>
  reprocess: Record<number, [number, number][]>
  certificates: Record<number, { n: L10n; g: number; skills: [number, number, number, number, number, number][] }>
  masteries: Record<number, number[][]>
  /** wc: wormhole class (1–6 J-space, 7 high, 8 low, 9 null, 12 Thera, 13 shattered, 25 Pochven…); fx: system effect beacon type */
  /** p: position in light years (for capital jump ranges) */
  systems: Record<number, { n: string; sec: number; r: number; c: number; wc?: number; fx?: number; p?: [number, number, number] }>
  regions: Record<number, L10n>
  constellations: Record<number, string>
  /** Stargate connections: system → neighbouring systems. */
  jumps: Record<number, number[]>
  factions: Record<number, L10n>
  races: Record<number, L10n>
  /** iconID → client resource path (res:/ui/texture/...) */
  icons: Record<number, string>
  /** Military Campaigns (Cradle of War), by UUID: title, subtitle, issuing faction, target progress */
  campaigns: Record<string, CampaignDef>
  /** Campaign objectives by UUID */
  campaignObjectives: Record<string, CampaignObjectiveDef>
  /** Freelance job types (DeliverItem, MineOre…): title and description */
  jobTypes: Record<string, { t: L10n; d: L10n }>
  /** Planetary industry schematics: name, cycle seconds, inputs [type, qty] per cycle, output [type, qty] */
  schematics: Record<number, PiSchematic>
  /** Planet types in each solar system (one entry per planet, for "where can I build this colony") */
  systemPlanets: Record<number, number[]>
  /** NPC corporations: name, faction */
  npcCorps: Record<number, { n: L10n; f?: number }>
  /** NPC corporation divisions (Security, Distribution…) */
  divisions: Record<number, L10n>
  /** Mission agents with the system they sit in */
  agents: SdeAgent[]
  /** Mutaplasmids: a: [attribute, min, max] multipliers; m: [modules it applies to, the abyssal module it makes] */
  mutaplasmids: Record<number, { a: [number, number, number][]; m: [number[], number][] }>
}

/** n: name, c: corporation, d: division, l: level, s: system; loc: finds players; st: in a station (otherwise in space) */
export interface SdeAgent {
  id: number
  n: string
  c: number
  d?: number
  l: number
  s: number
  loc?: 1
  st?: 1
}

/** An agent as the page shows it */
export interface AgentRow extends SdeAgent {
  corp: L10n
  div: L10n
  sys: string
  sec: number
  jumps?: number
}

/** One attribute a mutaplasmid rolls, with the module's own value */
export interface MutaRange {
  attr: number
  name: L10n
  unit?: number
  unitName: L10n
  high: boolean
  base: number
  min: number
  max: number
}

/** What inventing a T2 item takes: one source blueprint (T1 copy or relic) per way of inventing it */
export interface InventionData {
  product: number
  /** The T2 blueprint */
  blueprint: number
  unitsPerRun: number
  /** Manufacturing seconds per run */
  time: number
  materials: [number, number][]
  sources: {
    source: number
    baseChance: number
    /** Runs of the invented blueprint with no decryptor */
    baseRuns: number
    /** Invention seconds */
    time: number
    materials: [number, number][]
    /** Science skills, then the encryption skill */
    sciences: number[]
    encryption: number
  }[]
  decryptors: { id: number; chance: number; me: number; te: number; runs: number }[]
}

/** Compressed ore on the market: per unit volume, reprocessing per batch, and the uncompressed volume */
export interface CompressedOre {
  id: number
  portion: number
  volume: number
  rawVolume: number
  yields: [number, number][]
}

/** A mutaplasmid applying to a module */
export interface MutaOption {
  id: number
  n: L10n
  result: number
  ranges: MutaRange[]
}

/** A system for planetary colonies: its planets by type and which needed raw resources it lacks. */
export interface ColonySite {
  id: number
  n: string
  sec: number
  jumps: number
  /** planet type → how many */
  planets: Record<number, number>
  /** Indices (into the request's list) of the needs no planet here covers */
  missing: number[]
}

export interface PiSchematic {
  n: L10n
  t: number
  in: [number, number][]
  out: [number, number]
}

// ---------- IPC payloads ----------

export interface TypeBasic {
  id: number
  n: L10n
  g: number
  c: number
  meta?: number
  pub: boolean
  /** Packaged volume if the type has one, else its volume (m³). */
  v?: number
  /** Cargo / charge capacity (m³) */
  cap?: number
  /** kg */
  mass?: number
}

/** A market group as shown in the market / ship browser. */
export interface MarketNode {
  id: number
  n: L10n
  icon?: number
  /** Published items in this group and all its subgroups */
  count: number
}

export interface MarketLevel {
  groups: MarketNode[]
  types: TypeBasic[]
}

export interface ReqNode {
  skill: number
  level: number
  rank: number
  primary: number
  secondary: number
  children: ReqNode[]
}

export interface SkillReq {
  level: number
  rank: number
  primary: number
  secondary: number
}

export interface InfoAttribute {
  id: number
  n: L10n
  tt?: L10n
  cat: string
  value: number
  unit?: number
  high: boolean
  icon?: number
}

/** A dogma modifier translated for people: "when X, <target>'s <attribute> changes by <value>". */
export interface InfoModifier {
  state: 'passive' | 'online' | 'active' | 'overload'
  target: 'self' | 'ship' | 'char' | 'other' | 'location' | 'group' | 'skill' | 'selfSkill'
  group?: number
  skill?: number
  attr: number
  attrName: L10n
  attrIcon?: number
  op: number
  value: number
  unit?: number
  unitName?: L10n
  /** The value is per skill level */
  perLevel?: boolean
  note?: string
}

export interface InfoBundle {
  type: SdeType
  group: { id: number; n: L10n }
  category: { id: number; n: L10n }
  marketPath: L10n[]
  meta?: L10n
  race?: L10n
  faction?: L10n
  description?: L10n
  attributes: InfoAttribute[]
  effects: string[]
  modifiers: InfoModifier[]
  /** Skill whose levels scale ship hull bonuses (e.g. Gallente Cruiser) */
  boostsHullBonuses?: boolean
  traits?: { role?: Bonus[]; misc?: Bonus[]; skills?: { skill: number; bonuses: Bonus[] }[] }
  requirements: ReqNode[]
  skill?: { rank: number; primary: number; secondary: number }
  requiredFor?: { level: number; types: number[] }[]
  variations: number[]
  producedBy?: { bp: number; activity: string; data: BlueprintActivity; maxRuns: number }
  blueprint?: { maxRuns: number; act: Record<string, BlueprintActivity> }
  usedIn: { bp: number; product: number; qty: number; activity: string }[]
  reprocess?: [number, number][]
  masteries?: { level: number; certs: { id: number; n: L10n; skills: [number, number][] }[] }[]
  refs: Record<number, TypeBasic>
  units: Record<number, L10n>
  groupNames: Record<number, L10n>
  attrNames: Record<number, L10n>
}

export interface SkillCatalogGroup {
  id: number
  n: L10n
  skills: { id: number; n: L10n; rank: number; primary: number; secondary: number; pub: boolean }[]
}

export interface SdeStatus {
  state: 'idle' | 'checking' | 'downloading' | 'building' | 'ready' | 'error'
  build?: number
  releaseDate?: string
  /** 0..1 while downloading/building */
  progress?: number
  message?: string
}

/** Known space for the 3D map: parallel arrays indexed by system, positions in light years. */
export interface GalaxyData {
  ids: number[]
  names: string[]
  sec: number[]
  region: number[]
  /** x, y, z per system (SDE coordinates, light years) */
  pos: number[]
  /** 1 where a jump drive can jump to (lowsec / nullsec outside Pochven) */
  jump: number[]
  /** Stargate connections as pairs of indices into the arrays above */
  edges: number[]
  regions: Record<number, L10n>
}

export interface SystemBasic {
  id: number
  n: string
  sec: number
  region: L10n
  /** Wormhole class of the system (see SdeDb.systems) */
  wc?: number
  /** Wormhole system effect beacon (Pulsar, Magnetar…) */
  fx?: number
}

export interface JumpHop {
  from: number
  to: number
  /** Light years */
  ly: number
}

/** A wormhole type (the signature's code, e.g. "C247") with its limits. */
export interface WormholeType {
  id: number
  code: string
  /** Class of the system it leads to (wormhole class IDs, see SdeDb.systems) */
  target: number
  /** Minutes */
  lifetime: number
  /** kg */
  mass: number
  /** Heaviest ship that may pass, kg */
  jumpMass: number
  /** kg regenerated per day */
  regen: number
}
