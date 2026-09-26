// Types shared between the main process, preload and renderer.

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
}

export interface CanopusApi {
  request<T = unknown>(url: string, options?: RequestOptions): Promise<T>
  auth: {
    login(): Promise<CharacterAuth>
    characters(): Promise<CharacterAuth[]>
    logout(characterId: number): Promise<void>
    callbackUrl(): Promise<string>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  openExternal(url: string): Promise<void>
}
