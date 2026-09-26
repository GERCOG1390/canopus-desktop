import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { Card, ErrorBox } from '../components/ui'
import { imageUrl } from '../lib/esi'

export default function SettingsPage() {
  const { settings, characters, active, updateSettings, login, logout, setActive } = useApp()
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

      <Card title="Окно">
        <label className="check">
          <input type="checkbox" checked={settings?.alwaysOnTop ?? false} onChange={(e) => updateSettings({ alwaysOnTop: e.target.checked })} />
          Поверх всех окон (удобно поверх клиента игры в оконном режиме)
        </label>
      </Card>

      <Card title="Источники данных">
        <p className="muted small">
          ESI (CCP Games), zKillboard, EVE-Scout, Fuzzwork Market &amp; SDE. EVE Online и все связанные материалы — собственность CCP hf. Canopus не аффилирован с CCP.
        </p>
      </Card>
    </div>
  )
}
