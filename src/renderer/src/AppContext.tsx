import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { SdeStatus } from '../../shared/sde'
import type { CharacterAuth, Settings } from '../../shared/types'
import { setUiLang } from './i18n'
import { retryMissing, type Lang } from './lib/sde'

export type PageId = 'character' | 'intel' | 'fitting' | 'market' | 'map' | 'industry' | 'activities' | 'mail' | 'fleet' | 'pvp' | 'settings'

interface AppState {
  settings: Settings | null
  characters: CharacterAuth[]
  /** The selected logged-in character, if any. */
  active: CharacterAuth | null
  lang: Lang
  sde: SdeStatus
  page: PageId
  /** Optional argument for the current page, e.g. a type ID to open in Market. */
  pageArg: number | null
  navigate: (page: PageId, arg?: number | null) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  /** `extended`: also ask for the permissions to act in the game */
  login: (extended?: boolean) => Promise<void>
  logout: (id: number) => Promise<void>
  setActive: (id: number) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [characters, setCharacters] = useState<CharacterAuth[]>([])
  const [sde, setSde] = useState<SdeStatus>({ state: 'idle' })
  const [page, setPage] = useState<PageId>('character')
  const [pageArg, setPageArg] = useState<number | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.auth.characters().then(setCharacters)
    void window.api.sde.status().then(setSde)
    const offSettings = window.api.onSettingsChanged(() => void window.api.settings.get().then(setSettings))
    const offSde = window.api.sde.onStatus((s) => {
      setSde(s)
      if (s.state === 'ready') retryMissing()
    })
    return () => {
      offSettings()
      offSde()
    }
  }, [])

  const navigate = useCallback((p: PageId, arg: number | null = null) => {
    setPage(p)
    setPageArg(arg)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await window.api.settings.set(patch))
  }, [])

  const login = useCallback(async (extended?: boolean) => {
    const ch = await window.api.auth.login(extended)
    setCharacters(await window.api.auth.characters())
    setSettings(await window.api.settings.set({ activeCharacterId: ch.id }))
  }, [])

  const logout = useCallback(async (id: number) => {
    await window.api.auth.logout(id)
    const rest = await window.api.auth.characters()
    setCharacters(rest)
    const current = await window.api.settings.get()
    if (current.activeCharacterId === id) {
      setSettings(await window.api.settings.set({ activeCharacterId: rest[0]?.id ?? null }))
    }
  }, [])

  const setActive = useCallback((id: number) => updateSettings({ activeCharacterId: id }), [updateSettings])

  const active = characters.find((c) => c.id === settings?.activeCharacterId) ?? characters[0] ?? null
  const lang: Lang = settings?.lang === 'en' ? 0 : 1
  // The UI language follows the same setting as item names (applied before children render).
  setUiLang(settings?.lang === 'en' ? 'en' : 'ru')

  return (
    <Ctx.Provider value={{ settings, characters, active, lang, sde, page, pageArg, navigate, updateSettings, login, logout, setActive }}>
      {children}
    </Ctx.Provider>
  )
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}

export const useLang = (): Lang => useApp().lang
