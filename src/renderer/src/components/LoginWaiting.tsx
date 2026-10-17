// While an EVE SSO login runs in the user's browser: what to check there, and the ways out — open
// the page again, cancel, or log in inside a Canopus window when the browser can't hand the
// result back to Canopus.

import { useApp } from '../AppContext'

export function LoginWaiting() {
  const { loginPending, login } = useApp()
  if (!loginPending || loginPending.mode !== 'browser') return null
  const again = (mode: 'browser' | 'window') => void login(loginPending.extended, loginPending.corp, mode).catch(() => {})
  return (
    <div className="palette-backdrop relogin-backdrop">
      <div className="palette relogin" role="dialog" aria-modal="true" aria-labelledby="login-waiting-title">
        <h2 id="login-waiting-title">Вход через браузер</h2>
        <p>Страница входа EVE открыта в вашем браузере. Завершите вход там — Canopus получит результат сам.</p>
        <p className="muted small">
          Проверьте адрес: <b translate="no">login.eveonline.com</b> и замок сертификата рядом с ним. Пароль вводится только на сайте CCP — Canopus его не видит. Браузер может
          спросить, открыть ли Canopus: разрешите.
        </p>
        <div className="row">
          <button className="ghost" onClick={() => again('browser')}>
            Открыть браузер ещё раз
          </button>
          <button className="ghost" onClick={() => void window.api.auth.cancelLogin()}>
            Отмена
          </button>
        </div>
        <p className="muted small">
          Браузер не вернул вас в Canopus?{' '}
          <button className="gx-link" onClick={() => again('window')}>
            Войти в окне Canopus
          </button>
        </p>
      </div>
    </div>
  )
}
