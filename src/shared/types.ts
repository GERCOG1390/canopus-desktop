// Types shared between the main process, preload and renderer.

import type { InfoBundle, SdeStatus, SkillCatalogGroup, SkillReq, SystemBasic, TypeBasic } from './sde'

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
    requiredSkills(typeIds: number[]): Promise<Record<number, SkillReq>>
    dogmaAttrs(ids: number[], attrIds: number[]): Promise<Record<number, Record<number, number>>>
    blueprintForProduct(productId: number): Promise<InfoBundle['producedBy'] | null>
  }
}
