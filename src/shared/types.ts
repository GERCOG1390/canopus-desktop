// Types shared between the main process, preload and renderer.

import type { FitSpec, FitStats, FittableType, SavedFit, SkillSource } from './fit'
import type { ChannelInfo, ClipboardEvent, IntelReport, IntelSettings, LogEvent, OverlaySummary } from './intel'
import type { InfoBundle, L10n, SdeStatus, SkillCatalogGroup, SkillReq, SystemBasic, TypeBasic } from './sde'

export interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  /** Attach the ESI access token of this character (ESI hosts only). */
  characterId?: number
  /** Follow X-Pages and concatenate all pages of an array response. */
  allPages?: boolean
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
}

export interface CanopusApi {
  request<T = unknown>(url: string, options?: RequestOptions): Promise<T>
  auth: {
    login(): Promise<CharacterAuth>
    characters(): Promise<CharacterAuth[]>
    logout(characterId: number): Promise<void>
    callbackUrl(): Promise<string>
    /** Scopes Canopus requests at login. */
    scopes(): Promise<string[]>
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
    requiredSkills(typeIds: number[]): Promise<Record<number, SkillReq>>
    dogmaAttrs(ids: number[], attrIds: number[]): Promise<Record<number, Record<number, number>>>
    blueprintForProduct(productId: number): Promise<InfoBundle['producedBy'] | null>
  }
  /** Settings changed outside the renderer (e.g. overlay hotkeys). */
  onSettingsChanged(listener: () => void): () => void
  intel: {
    onClipboard(listener: (e: ClipboardEvent) => void): () => void
    onLog(listener: (e: LogEvent) => void): () => void
    /** Re-read the Local log (e.g. after the active character or log folder changed). */
    restartLog(): Promise<void>
    /** Main window → overlay. */
    publish(summary: OverlaySummary): Promise<void>
    onSummary(listener: (s: OverlaySummary) => void): () => void
    lastSummary(): Promise<OverlaySummary | null>
    notify(title: string, body: string): Promise<void>
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
  fit: {
    calculate(spec: FitSpec, skills: SkillSource): Promise<FitStats>
    catalog(): Promise<FittableType[]>
    explain(spec: FitSpec, skills: SkillSource, target: string, attr: number): Promise<{ base: number; value: number; mods: { type: number; kind: string; op: number; value: number }[] }>
    charges(moduleTypeId: number): Promise<number[]>
    list(): Promise<SavedFit[]>
    save(fit: FitSpec & { id?: string }): Promise<SavedFit>
    delete(id: string): Promise<void>
  }
}
