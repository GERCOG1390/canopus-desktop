// After an update that needs new ESI permissions: characters whose token lacks them must log in
// again. A blocking dialog lists them; logging in again (keeping the opt-in permissions the
// character had: in-game actions, corporation) or removing the character are the ways out.

import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { imageUrl } from '../lib/esi'
import { translate } from '../i18n'
import type { CharacterAuth } from '../../../shared/types'

type Tiers = { base: string[]; extra: string[]; corp: string[] }

/** What a character still needs: every base scope, and an opt-in tier complete once any of it was granted. */
function missing(c: CharacterAuth, t: Tiers): { scopes: string[]; extra: boolean; corp: boolean } {
  const has = (s: string) => c.scopes.includes(s)
  const extra = t.extra.some(has)
  const corp = t.corp.some(has)
  const scopes = [...t.base, ...(extra ? t.extra : []), ...(corp ? t.corp : [])].filter((s) => !has(s))
  return { scopes, extra, corp }
}

/** Plain words for the permissions added lately. */
const WHAT: Record<string, string> = {
  'esi.activity.char:read': 'вклад в военные кампании',
  'esi-characters.read_freelance_jobs.v1': 'ваши фриланс-работы',
  'esi-corporations.read_projects.v1': 'проекты корпорации',
  'esi-characters.read_notifications.v1': 'уведомления об атаках на структуры',
  'esi-industry.read_corporation_mining.v1': 'лунная добыча корпорации',
  'esi-corporations.read_structures.v1': 'структуры корпорации'
}

export function ReloginGate() {
  const { characters, login, logout } = useApp()
  const [tiers, setTiers] = useState<Tiers | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void window.api.auth.scopeTiers().then(setTiers), [])
  if (!tiers) return null
  const stale = characters.map((c) => ({ c, m: missing(c, tiers) })).filter((x) => x.m.scopes.length)
  if (!stale.length) return null

  async function again(c: CharacterAuth, extra: boolean, corp: boolean) {
    setBusy(c.id)
    setError(null)
    try {
      await login(extra, corp)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="palette-backdrop relogin-backdrop">
      <div className="palette relogin" role="dialog" aria-modal="true" aria-labelledby="relogin-title">
        <h2 id="relogin-title">Нужно войти заново</h2>
        <p className="muted">
          Новым функциям этой версии нужны дополнительные разрешения EVE. Войдите заново каждым персонажем из списка — в окне EVE выберите именно его. Пока это не сделано, Canopus не
          может работать с этими персонажами полностью.
        </p>
        <ul className="relogin-list">
          {stale.map(({ c, m }) => {
            const known = [...new Set(m.scopes.map((s) => WHAT[s]).filter(Boolean))].map(translate)
            return (
              <li key={c.id}>
                <img src={imageUrl.portrait(c.id, 64)} width={40} height={40} alt="" />
                <div className="grow">
                  <b translate="no">{c.name}</b>
                  <div className="muted small">{known.length ? `Появилось: ${known.join(', ')}` : `Новых разрешений: ${m.scopes.length}`}</div>
                </div>
                <button disabled={busy !== null} onClick={() => void again(c, m.extra, m.corp)}>
                  {busy === c.id ? 'Ожидаю вход…' : 'Войти заново'}
                </button>
                <button className="ghost small" disabled={busy !== null} onClick={() => void logout(c.id)} title="Убрать персонажа из Canopus">
                  Удалить
                </button>
              </li>
            )
          })}
        </ul>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
