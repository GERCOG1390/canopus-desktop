import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { Card, ErrorBox } from '../components/ui'
import { imageUrl } from '../lib/esi'
import { locale } from '../i18n'
import { fmtDate } from '../lib/format'
import type { NotifyEvent, NotifySettings } from '../../../shared/notify'

export default function SettingsPage() {
  const { settings, characters, active, sde, updateSettings, login, logout, setActive } = useApp()
  const [wantedScopes, setWantedScopes] = useState<string[]>([])
  useEffect(() => void window.api.auth.scopes().then(setWantedScopes), [])
  const missingScopes = active ? wantedScopes.filter((s) => !active.scopes.includes(s)) : []
  const [clientId, setClientId] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => setClientId(settings?.clientId ?? ''), [settings?.clientId])
  useEffect(() => void window.api.auth.callbackUrl().then(setCallbackUrl), [])

  async function doLogin() {
    setBusy(true)
    setError(null)
    try {
      await login()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveClientId() {
    await updateSettings({ clientId: clientId.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="page">
      <Card title="Персонажи">
        {characters.length === 0 && <p className="muted">Пока нет авторизованных персонажей.</p>}
        <ul className="char-list">
          {characters.map((c) => (
            <li key={c.id} className={c.id === active?.id ? 'selected' : ''}>
              <img src={imageUrl.portrait(c.id, 64)} width={40} height={40} alt="" />
              <span className="grow">{c.name}</span>
              {c.id !== active?.id && (
                <button className="ghost" onClick={() => setActive(c.id)}>
                  Сделать активным
                </button>
              )}
              <button className="ghost danger" onClick={() => logout(c.id)}>
                Выйти
              </button>
            </li>
          ))}
        </ul>
        <button onClick={doLogin} disabled={busy || !settings?.clientId}>
          {busy ? 'Ожидаю вход в браузере…' : 'Добавить персонажа (EVE SSO)'}
        </button>
        {!settings?.clientId && <p className="muted small">Сначала укажите Client ID ниже.</p>}
        <ErrorBox error={error} />
      </Card>

      <Card title="Приложение EVE SSO">
        <ol className="steps">
          <li>
            Откройте{' '}
            <a href="https://developers.eveonline.com/applications" target="_blank" rel="noreferrer">
              developers.eveonline.com/applications
            </a>{' '}
            и создайте приложение (Create New Application).
          </li>
          <li>
            Connection Type: <b>Authentication &amp; API Access</b>. Отметьте все scopes, которые предлагает Canopus (или все подряд).
          </li>
          <li>
            Callback URL: <code className="copy">{callbackUrl}</code>{' '}
            <button className="ghost small" onClick={() => navigator.clipboard.writeText(callbackUrl)}>
              Копировать
            </button>
          </li>
          <li>Скопируйте Client ID сюда. Secret Key не нужен: Canopus использует PKCE.</li>
        </ol>
        <div className="row">
          <input className="grow" placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <button onClick={saveClientId} disabled={clientId.trim() === (settings?.clientId ?? '')}>
            Сохранить
          </button>
          {saved && <span className="good">Сохранено</span>}
        </div>
      </Card>

      <Card title="Язык и данные EVE (SDE)">
        <div className="row">
          <label>
            Язык названий и описаний
            <select value={settings?.lang ?? 'ru'} onChange={(e) => updateSettings({ lang: e.target.value as 'ru' | 'en' })}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        <p className="muted small">
          Статическая база CCP:{' '}
          {sde.state === 'ready'
            ? `сборка ${sde.build} от ${sde.releaseDate ? new Date(sde.releaseDate).toLocaleDateString(locale()) : '?'}`
            : sde.state === 'error'
              ? `ошибка — ${sde.message}`
              : 'загружается…'}
          {sde.message && sde.state === 'ready' ? ` (${sde.message})` : ''}
        </p>
        <button className="ghost" onClick={() => void window.api.sde.update()} disabled={sde.state === 'downloading' || sde.state === 'building'}>
          Проверить обновление SDE
        </button>
      </Card>

      {active && missingScopes.length > 0 && (
        <Card title="Нужно обновить доступ">
          <div className="warn">
            Токену персонажа {active.name} не хватает разрешений ({missingScopes.length}) для имплантов, клонов, фитов, чертежей, контрактов, LP и репутации. Отметьте в приложении на developers.eveonline.com эти scopes и нажмите «Добавить персонажа» ещё раз:
            <div className="mono small">{missingScopes.join(' ')}</div>
          </div>
        </Card>
      )}

      <Card title="Окно">
        <label className="check">
          <input type="checkbox" checked={settings?.alwaysOnTop ?? false} onChange={(e) => updateSettings({ alwaysOnTop: e.target.checked })} />
          Поверх всех окон (удобно поверх клиента игры в оконном режиме)
        </label>
      </Card>

      <NotifyCard />

      <Card title="Источники данных">
        <p className="muted small">
          ESI (CCP Games), zKillboard, EVE-Scout, Fuzzwork Market &amp; SDE. EVE Online и все связанные материалы — собственность CCP hf. Canopus не аффилирован с CCP.
        </p>
      </Card>
    </div>
  )
}

const NOTIFY_KINDS: [keyof Omit<NotifySettings, 'tray' | 'skillHours'>, string][] = [
  ['skills', 'Очередь навыков кончается или пуста'],
  ['pi', 'Экстракторы планетарки остановились'],
  ['industry', 'Работа в индустрии готова'],
  ['fatigue', 'Усталость от прыжков прошла'],
  ['orders', 'Ваш ордер на рынке перебили'],
  ['clone', 'Доступен прыжок клона']
]

function NotifyCard() {
  const { settings, updateSettings } = useApp()
  const [history, setHistory] = useState<NotifyEvent[]>([])
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    void window.api.notify.history().then(setHistory)
  }, [])
  if (!settings) return null
  const n = settings.notify
  const set = (patch: Partial<NotifySettings>) => updateSettings({ notify: { ...n, ...patch } })
  return (
    <Card title="Трей и уведомления">
      <label className="check">
        <input type="checkbox" checked={n.tray} onChange={(e) => set({ tray: e.target.checked })} />
        Сворачивать в трей при закрытии окна (уведомления продолжают работать)
      </label>
      <p className="muted small">Canopus раз в 5 минут проверяет всех вошедших персонажей и показывает уведомление Windows — один раз на каждое событие.</p>
      {NOTIFY_KINDS.map(([key, label]) => (
        <label key={key} className="check">
          <input type="checkbox" checked={n[key]} onChange={(e) => set({ [key]: e.target.checked } as Partial<NotifySettings>)} />
          {label}
        </label>
      ))}
      <div className="row">
        <label>
          Предупреждать об очереди навыков заранее
          <select value={n.skillHours} onChange={(e) => set({ skillHours: Number(e.target.value) })}>
            <option value={0}>Только когда пуста</option>
            <option value={6}>За 6 ч</option>
            <option value={12}>За 12 ч</option>
            <option value={24}>За 24 ч</option>
            <option value={48}>За 48 ч</option>
          </select>
        </label>
        <button
          className="ghost"
          disabled={checking}
          onClick={async () => {
            setChecking(true)
            await window.api.notify.checkNow().catch(() => undefined)
            setHistory(await window.api.notify.history())
            setChecking(false)
          }}
        >
          {checking ? 'Проверяю…' : 'Проверить сейчас'}
        </button>
      </div>
      {history.length > 0 && (
        <table className="table compact">
          <tbody>
            {history.slice(0, 10).map((h, i) => (
              <tr key={i}>
                <td className="muted small nowrap">{fmtDate(h.at)}</td>
                <td translate="no">
                  <b>{h.title}</b>
                  <div className="muted small">{h.body}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
