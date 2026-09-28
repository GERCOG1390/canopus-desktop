import { useState, type ReactNode } from 'react'
import { useApp } from '../AppContext'
import type { CharacterAuth } from '../../../shared/types'
import { hasScope } from '../lib/gameActions'

/**
 * A button that does something in the game client for the active character. Without the needed
 * permission it is disabled and explains how to grant it.
 */
export function GameButton({
  scope,
  action,
  children,
  title,
  className = 'ghost',
  done = '✓',
  confirm
}: {
  scope: string
  action: (who: CharacterAuth) => Promise<unknown>
  children: ReactNode
  title?: string
  className?: string
  /** Shown briefly after success */
  done?: string
  /** Ask before doing it (deleting something in the game) */
  confirm?: string
}) {
  const { active } = useApp()
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; error?: string }>({})
  const allowed = hasScope(active, scope)
  const hint = !active
    ? 'Войдите персонажем через EVE SSO'
    : !allowed
      ? 'Нужно разрешение: «Настройки → Разрешить действия в игре»'
      : state.error ?? title

  async function run() {
    if (!active || !allowed) return
    if (confirm && !window.confirm(confirm)) return
    setState({ busy: true })
    try {
      await action(active)
      setState({ ok: true })
      setTimeout(() => setState({}), 2500)
    } catch (e) {
      setState({ error: (e as Error).message })
    }
  }

  return (
    <button className={`${className} game-btn ${state.error ? 'has-error' : ''}`} disabled={!allowed || state.busy} title={hint} onClick={() => void run()}>
      {children}
      {state.ok && <span className="good"> {done}</span>}
      {state.error && <span className="bad"> ⚠</span>}
    </button>
  )
}
