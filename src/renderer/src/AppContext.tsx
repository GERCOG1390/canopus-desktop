import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CharacterAuth, Settings } from '../../shared/types'

interface AppState {
  settings: Settings | null
  characters: CharacterAuth[]
  /** The selected logged-in character, if any. */
  active: CharacterAuth | null
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  login: () => Promise<void>
  logout: (id: number) => Promise<void>
  setActive: (id: number) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [characters, setCharacters] = useState<CharacterAuth[]>([])

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.auth.characters().then(setCharacters)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await window.api.settings.set(patch))
  }, [])

  const login = useCallback(async () => {
    const ch = await window.api.auth.login()
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

  return (
    <Ctx.Provider value={{ settings, characters, active, updateSettings, login, logout, setActive }}>
      {children}
    </Ctx.Provider>
  )
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
