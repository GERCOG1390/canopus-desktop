// Types shared between the main process, preload and renderer.

import type { CombatPilot, CombatResult, CombatScenario } from './combat'
import type { AssistantAccount, AssistantAuth, AssistantSettings, AssistantTurn, ResponseItem, ToolDef } from './assistant'

/** A fit for the snapshot window, with the name of the character whose skills it uses */
export type FitShotData = CombatPilot & { pilotName?: string }
import type { FitMetrics, FitSpec, FitStats, FitVariant, FittableType, SavedFit, SkillSource } from './fit'
import type { NotifyEvent, NotifySettings } from './notify'
import type { CombatLogEvent } from './ratting'
import type { UpdateStatus } from './update'
import type { StreamSettings, StreamState, StreamStatus } from './stream'
import type { FreelanceFilter } from './freelance'
import type { WidgetSettings, WidgetView } from './widgets'
import type { ClientWindow, PreviewSettings } from './previews'
import type { ChannelInfo, ClipboardEvent, IntelReport, IntelSettings, LogEvent, OverlaySummary } from './intel'
import type { CampaignDef, CampaignObjectiveDef, GalaxyData, JumpHop, WormholeType } from './sde'
import type { InfoBundle, L10n, MarketLevel, SdeStatus, SkillCatalogGroup, SkillReq, SystemBasic, TypeBasic } from './sde'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** Attach the ESI access token of this character (ESI hosts only). */
  characterId?: number
  /** Follow X-Pages and concatenate all pages of an array response. */
  allPages?: boolean
  /** Skip the cache (e.g. right after changing something in the game) */
  fresh?: boolean
  /** Newer ESI routes (no /latest/ prefix) want a compatibility date (X-Compatibility-Date) */
  compat?: string
}

export interface CharacterAuth {
  id: number
  name: string
  scopes: string[]
}

export interface Settings {
  clientId: string
  activeCharacterId: number | null
  alwaysOnTop: boolean
  /** Language for item names and descriptions from the SDE. */
  lang: 'ru' | 'en'
  intel: IntelSettings
  notify: NotifySettings
  /** Check GitHub for new versions, download them in the background and install on restart. */
  autoUpdate: boolean
  /** Accent theme; the violet base is the same for all of them. */
  theme: ThemeId
  /** compact: denser rows and 13px text; comfortable: 14px. */
  density: 'compact' | 'comfortable'
  stream: StreamSettings
  freelance: FreelanceFilter
  widgets: WidgetSettings
  previews: PreviewSettings
  assistant: AssistantSettings
}

export type ThemeId = 'canopus' | 'photon' | 'amarr' | 'caldari' | 'gallente' | 'minmatar'

export interface CanopusApi {
  previews: {
    list(): Promise<ClientWindow[]>
    activate(client: ClientWindow): Promise<void>
    set(patch: Partial<PreviewSettings>): Promise<PreviewSettings>
    permissions(): Promise<{ screen: string; accessibility: boolean }>
    onActive(listener: (id: string) => void): () => void
    onSettings(listener: () => void): () => void
  }
  widgets: {
    set(view: WidgetView, enabled: boolean): Promise<WidgetSettings>
    setOpacity(opacity: number): Promise<WidgetSettings>
  }
  stream: {
    status(): Promise<StreamStatus>
    state(): Promise<StreamState>
    resetSession(): Promise<void>
    onStatus(listener: (s: StreamStatus) => void): () => void
  }
  request<T = unknown>(url: string, options?: RequestOptions): Promise<T>
  auth: {
    /** Log in; `extended` also asks for the permissions to act in the game (open windows, fits, mail, contacts, fleet, calendar). */
    login(extended?: boolean, corp?: boolean, mode?: 'browser' | 'window'): Promise<CharacterAuth>
    cancelLogin(): Promise<void>
    extraScopes(): Promise<string[]>
    characters(): Promise<CharacterAuth[]>
    logout(characterId: number): Promise<void>
    callbackUrl(): Promise<string>
    /** Scopes Canopus requests at login. */
    scopes(): Promise<string[]>
    /** Scopes of each login tier: base, in-game actions, corporation */
    scopeTiers(): Promise<{ base: string[]; extra: string[]; corp: string[] }>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  openExternal(url: string): Promise<void>
  sde: {
    status(): Promise<SdeStatus>
    onStatus(listener: (status: SdeStatus) => void): () => void
    update(): Promise<void>
    basics(ids: number[]): Promise<Record<number, TypeBasic>>
    search(query: string, opts?: { limit?: number; marketOnly?: boolean; categories?: number[] }): Promise<TypeBasic[]>
    searchSystems(query: string, limit?: number): Promise<SystemBasic[]>
    system(id: number): Promise<SystemBasic | null>
    info(typeId: number): Promise<InfoBundle>
    skillCatalog(): Promise<SkillCatalogGroup[]>
    /** attributeID → iconID */
    attributeIcons(): Promise<Record<number, number>>
    groupNames(ids: number[]): Promise<Record<number, L10n>>
    /** One level of the market tree (null = top level). */
    marketChildren(parent: number | null, order: 'name' | 'size', lang: 0 | 1, filterKey?: string): Promise<MarketLevel>
    /** Restrict the tree to these items when marketChildren gets the same key. */
    setMarketFilter(key: string, ids: number[]): Promise<void>
    /** Market groups from the top level down to the item's group. */
    marketPath(typeId: number): Promise<number[]>
    /** Published items anywhere under a market group. */
    marketTypesIn(groupId: number): Promise<number[]>
    wormholeTypes(): Promise<WormholeType[]>
    /** Fewest-jumps capital route within a jump range (null when unreachable). */
    jumpRoute(from: number, to: number, rangeLy: number): Promise<JumpHop[] | null>
    lightYears(from: number, to: number): Promise<number | null>
    galaxy(): Promise<GalaxyData>
    jobTypes(): Promise<Record<string, { t: L10n; d: L10n }>>
    campaigns(): Promise<{ campaigns: Record<string, CampaignDef>; objectives: Record<string, CampaignObjectiveDef>; factions: Record<number, L10n> }>
    blueprintProducts(ids: number[]): Promise<Record<number, number>>
    parseBridges(text: string): Promise<{ bridges: [number, number][]; unknown: string[] }>
    routeLocal(from: number, to: number, flag: 'secure' | 'shortest' | 'insecure', bridges: [number, number][], avoid?: number[]): Promise<{ ids: number[]; bridgeHops: number } | null>
    requiredSkills(typeIds: number[]): Promise<Record<number, SkillReq>>
    /** Skill levels needed for the goals, prerequisites first, one step per level. */
    skillPlan(goals: { typeId: number; level?: number }[]): Promise<{ skill: number; level: number; rank: number; primary: number; secondary: number }[]>
    dogmaAttrs(ids: number[], attrIds: number[]): Promise<Record<number, Record<number, number>>>
    blueprintForProduct(productId: number): Promise<InfoBundle['producedBy'] | null>
  }
  /** Settings changed outside the renderer (e.g. overlay hotkeys). */
  onSettingsChanged(listener: () => void): () => void
  /** JSON documents kept in the profile folder across restarts. */
  store: {
    get<T = unknown>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
  }
  ratting: {
    /** Events parsed from the current game log. */
    events(): Promise<CombatLogEvent[]>
    onEvents(listener: (e: CombatLogEvent[]) => void): () => void
    /** A new game log started (relog): previous events are gone. */
    onReset(listener: (e: { file: string }) => void): () => void
  }
  update: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<UpdateStatus>
    installAndRestart(): Promise<void>
    onStatus(listener: (status: UpdateStatus) => void): () => void
  }
  notify: {
    /** Notifications shown since Canopus started, newest first. */
    history(): Promise<NotifyEvent[]>
    checkNow(): Promise<void>
  }
  intel: {
    onClipboard(listener: (e: ClipboardEvent) => void): () => void
    onLog(listener: (e: LogEvent) => void): () => void
    /** Re-read the Local log (e.g. after the active character or log folder changed). */
    restartLog(): Promise<void>
    /** Main window → overlay. */
    publish(summary: OverlaySummary): Promise<void>
    onSummary(listener: (s: OverlaySummary) => void): () => void
    lastSummary(): Promise<OverlaySummary | null>
    notify(title: string, body: string, kind?: 'local' | 'channel'): Promise<void>
    testDiscord(url: string): Promise<string | null>
    setOverlay(patch: Partial<IntelSettings['overlay']>): Promise<void>
    /** Exact (case-insensitive) type name → type ID, English or Russian. */
    resolveTypeNames(names: string[]): Promise<Record<string, number>>
    /** New lines in watched intel channels. */
    onReport(listener: (r: IntelReport) => void): () => void
    /** The set of followed channel logs changed. */
    onChannels(listener: (c: ChannelInfo[]) => void): () => void
    /** Channels found in recent chat logs. */
    listChannels(): Promise<ChannelInfo[]>
    channelStatus(): Promise<ChannelInfo[]>
    /** Reports already read before the window subscribed. */
    recentReports(): Promise<IntelReport[]>
    /** Stargate jumps from a system to others (unreachable / far ones omitted). */
    jumpsFrom(fromId: number, ids: number[]): Promise<Record<number, number>>
    systemId(name: string): Promise<number | null>
  }
  assistant: {
    account(): Promise<AssistantAccount>
    /** Checks and stores an OpenAI API key (encrypted); returns the chat models it can use */
    setKey(key: string): Promise<string[]>
    clearKey(): Promise<void>
    /** Sign in with ChatGPT in the browser (the user's Plus/Pro plan pays) */
    chatgptLogin(): Promise<AssistantAccount>
    chatgptCancel(): Promise<void>
    chatgptLogout(): Promise<void>
    models(mode: AssistantAuth): Promise<string[]>
    /** One model turn (Responses API); the text streams through onDelta */
    respond(requestId: string, mode: AssistantAuth, model: string, instructions: string, input: ResponseItem[], tools: ToolDef[]): Promise<AssistantTurn>
    onDelta(listener: (requestId: string, delta: string) => void): () => void
  }
  fitShot: {
    /** Open the snapshot window (or show this fit in it): every module and the stats on one card. */
    open(pilot: FitShotData): Promise<void>
    get(): Promise<FitShotData | null>
    onFit(listener: (p: FitShotData) => void): () => void
    /** Size the window around the card */
    resize(width: number, height: number): Promise<void>
    /** Picture of a part of the window to the clipboard or a PNG file; false when the save was cancelled */
    capture(rect: { x: number; y: number; width: number; height: number }, to: 'clipboard' | 'file', name: string): Promise<boolean>
  }
  combat: {
    /** Open (or focus) the simulator window with this fit as "your" side. */
    open(attacker: CombatPilot): Promise<void>
    /** Keep the simulator's "your" side in sync with the fitting tool. */
    setAttacker(attacker: CombatPilot): Promise<void>
    isOpen(): Promise<boolean>
    getAttacker(): Promise<CombatPilot | null>
    onAttacker(listener: (a: CombatPilot) => void): () => void
    simulate(a: CombatPilot, b: CombatPilot, scenario: CombatScenario): Promise<CombatResult>
    defaults(a: CombatPilot, b: CombatPilot): Promise<{ speedA: number; speedB: number; sigA: number; sigB: number }>
  }
  fit: {
    /** What the next level of each skill would change on this fit (skills that change nothing are left out). */
    /** Every fitted module / drone type swapped for its other versions, with the resulting numbers */
    variants(spec: FitSpec, skills: SkillSource): Promise<{ base: FitMetrics; options: FitVariant[] }>
    metrics(spec: FitSpec, skills: SkillSource): Promise<FitMetrics>
    skillGains(spec: FitSpec, levels: Record<number, number>): Promise<{ skill: number; from: number; dps: number; ehp: number; activeTank: number; speed: number; align: number; capacitor: number; lockRange: number }[]>
    calculate(spec: FitSpec, skills: SkillSource): Promise<FitStats>
    catalog(): Promise<FittableType[]>
    /** Catalog items this hull can take at all (group/type restrictions, rig size, capital modules, drone bay). */
    fittableFor(shipTypeId: number): Promise<number[]>
    explain(spec: FitSpec, skills: SkillSource, target: string, attr: number): Promise<{ base: number; value: number; mods: { type: number; kind: string; op: number; value: number }[] }>
    charges(moduleTypeId: number): Promise<number[]>
    list(): Promise<SavedFit[]>
    save(fit: FitSpec & { id?: string }): Promise<SavedFit>
    delete(id: string): Promise<void>
  }
}
