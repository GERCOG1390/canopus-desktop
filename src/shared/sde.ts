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
export const SDE_FORMAT = 3

export interface SdeDb {
  format: number
  build: number
  releaseDate: string
  types: Record<number, SdeType>
  groups: Record<number, { n: L10n; c: number; pub: boolean }>
  categories: Record<number, { n: L10n; pub: boolean }>
  marketGroups: Record<number, { n: L10n; p?: number }>
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
  systems: Record<number, { n: string; sec: number; r: number; c: number }>
  regions: Record<number, L10n>
  constellations: Record<number, string>
  factions: Record<number, L10n>
  races: Record<number, L10n>
  /** iconID → client resource path (res:/ui/texture/...) */
  icons: Record<number, string>
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

export interface SystemBasic {
  id: number
  n: string
  sec: number
  region: L10n
}
