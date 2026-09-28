import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { Card, ErrorBox } from '../components/ui'
import { imageUrl } from '../lib/esi'
import { locale } from '../i18n'
import { fmtDate } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useUpdate } from '../lib/update'
import { THEMES } from '../lib/appearance'
import type { NotifyEvent, NotifySettings } from '../../../shared/notify'

export default function SettingsPage() {
  const { settings, characters, active, sde, updateSettings, login, logout, setActive } = useApp()
  const [wantedScopes, setWantedScopes] = useState<string[]>([])
  useEffect(() => void window.api.auth.scopes().then(setWantedScopes), [])
  const missingScopes = active ? wantedScopes.filter((s) => !active.scopes.includes(s)) : []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)


  const extra = useAsync(() => window.api.auth.extraScopes(), [])

  async function doLogin(extended = false) {
    setBusy(true)
    setError(null)
    try {
      await login(extended)
    } catch (e) {
      const msg = (e as Error).message
      // The SSO refuses scopes the EVE application doesn't list.
      setError(extended && /scope|отмен|cancel/i.test(msg) ? `${msg}. Если EVE SSO отказал в разрешениях, их нужно добавить в приложение Canopus на developers.eveonline.com (см. ниже).` : msg)
    } finally {
      setBusy(false)
    }
  }


  return (
    <div className="page">
      <Card title="Персонажи">
        {characters.length === 0 && <p className="muted">Пока нет авторизованных персонажей.</p>}
        <ul className="char-list">
          {characters.map((c) => (
            <li key={c.id} className={c.id === active?.id ? 'selected' : ''}>
              <img src={imageUrl.portrait(c.id, 64)} width={40} height={40} alt="" />
              <span className="grow">
                {c.name}
                {extra.data && extra.data.every((sc) => c.scopes.includes(sc)) ? (
                  <span className="good small"> · действия в игре разрешены</span>
                ) : (
                  <span className="muted small"> · только чтение</span>
                )}
              </span>
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
        <div className="row">
          <button onClick={() => void doLogin()} disabled={busy}>
            {busy ? 'Ожидаю вход…' : 'Добавить персонажа (EVE SSO)'}
          </button>
          <button className="ghost" onClick={() => void doLogin(true)} disabled={busy} title="Войти ещё раз с разрешениями на действия в игре">
            Разрешить действия в игре
          </button>
        </div>
        <p className="muted small">
          «Разрешить действия в игре» — вход с дополнительными разрешениями: открывать окна в клиенте (рынок, Show Info, контракты, письмо), сохранять фиты в игру, почта,
          контакты, управление флотом, календарь. Canopus ничего не делает в игре сам — только по вашей кнопке.
        </p>
        <ErrorBox error={error} />
        {extra.data && (
          <details className="small">
            <summary className="muted">Для владельца приложения Canopus: какие разрешения должны быть включены на developers.eveonline.com</summary>
            <div className="mono small">{extra.data.join(' ')}</div>
          </details>
        )}
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
            Токену персонажа {active.name} не хватает разрешений ({missingScopes.length}) для имплантов, клонов, фитов, чертежей, контрактов, LP и репутации. Нажмите «Добавить персонажа» и войдите этим персонажем ещё раз — новый токен получит все разрешения:
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

      <AppearanceCard />

      <NotifyCard />

      <UpdateCard />

      <Card title="Источники данных">
        <p className="muted small">
          ESI (CCP Games), zKillboard, EVE-Scout, Fuzzwork Market &amp; SDE. EVE Online и все связанные материалы — собственность CCP hf. Canopus не аффилирован с CCP.
        </p>
      </Card>
    </div>
  )
}

function AppearanceCard() {
  const { settings, updateSettings } = useApp()
  if (!settings) return null
  return (
    <Card title="Внешний вид">
      <div className="theme-picker" role="radiogroup" aria-label="Цвет акцента">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={settings.theme === t.id}
            className={`theme-swatch ${settings.theme === t.id ? 'selected' : ''}`}
            onClick={() => void updateSettings({ theme: t.id })}
          >
            <span className="theme-dot" style={{ background: t.color }} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="row">
        <div className="tabs" role="radiogroup" aria-label="Плотность">
          <button className={settings.density === 'comfortable' ? 'tab active' : 'tab'} onClick={() => void updateSettings({ density: 'comfortable' })}>
            Удобно
          </button>
          <button className={settings.density === 'compact' ? 'tab active' : 'tab'} onClick={() => void updateSettings({ density: 'compact' })}>
            Компактно
          </button>
        </div>
        <span className="muted small">Компактно — мельче текст и плотнее строки, больше данных на экране (удобно в бою).</span>
      </div>
    </Card>
  )
}

/** Release notes as GitHub Markdown: headings, bullet lists and **bold** are enough for ours. */
function ReleaseNotes({ text }: { text: string }) {
  const inline = (line: string) => line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))
  return (
    <div className="release-notes small" translate="no">
      {text.split(/\r?\n/).map((line, i) => {
        const heading = line.match(/^#+\s+(.*)/)
        if (heading) return <h4 key={i}>{inline(heading[1])}</h4>
        const item = line.match(/^\s*[-*]\s+(.*)/)
        if (item) return <div key={i} className="release-item">• {inline(item[1])}</div>
        return line.trim() ? <p key={i}>{inline(line)}</p> : null
      })}
    </div>
  )
}

function UpdateCard() {
  const { settings, updateSettings } = useApp()
  const u = useUpdate()
  if (!settings || !u) return null
  const busy = u.state === 'checking' || u.state === 'downloading'
  return (
    <Card title="Обновления">
      <p>
        Установлена версия <b>{u.current}</b>
        {u.kind === 'portable' ? ' (portable)' : ''}.{' '}
        {u.state === 'checking'
          ? 'Проверяю…'
          : u.state === 'latest'
            ? 'Это последняя версия.'
            : u.state === 'error'
              ? `Не удалось проверить: ${u.message}`
              : u.version
                ? u.state === 'ready'
                  ? `Версия ${u.version} загружена и проверена.`
                  : u.state === 'downloading'
                    ? `Загружаю ${u.version}… ${Math.round((u.progress ?? 0) * 100)}%`
                    : `Доступна версия ${u.version}.`
                : ''}
        {u.checkedAt && <span className="muted small"> {`Проверено ${fmtDate(u.checkedAt)}.`}</span>}
      </p>
      <label className="check">
        <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => updateSettings({ autoUpdate: e.target.checked })} />
        Автоматически обновлять: проверять GitHub при запуске и каждые 6 часов, скачивать в фоне и устанавливать при перезапуске
      </label>
      <div className="row">
        <button className="ghost" disabled={busy} onClick={() => void window.api.update.check()}>
          Проверить обновления
        </button>
        {u.state === 'available' && u.kind !== 'manual' && <button onClick={() => void window.api.update.download()}>Скачать {u.version}</button>}
        {u.state === 'ready' && <button onClick={() => void window.api.update.installAndRestart()}>Перезапустить и обновить</button>}
        {u.page && (
          <button className="ghost" onClick={() => void window.api.openExternal(u.page!)}>
            Страница релиза
          </button>
        )}
      </div>
      {u.kind === 'manual' && <p className="muted small">Эта копия запущена не из установщика и не из portable-файла — новую версию скачайте со страницы релиза.</p>}
      {u.notes && u.version && (
        <details open>
          <summary className="muted">{`Что нового в ${u.version}`}</summary>
          <ReleaseNotes text={u.notes} />
        </details>
      )}
    </Card>
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
