// A section that throws while rendering shows the error in its place instead of blanking the whole
// window; the menu and the other sections keep working.

import { Component, type ReactNode } from 'react'
import { reportBug } from '../lib/feedback'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('Section crashed:', error)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <div className="error">
          <b>Раздел не смог отобразиться.</b> {this.state.error.message}
        </div>
        <div className="row">
          <button onClick={() => this.setState({ error: null })}>Попробовать снова</button>
          <button className="ghost" onClick={() => reportBug(`${this.state.error!.message}\n${this.state.error!.stack ?? ''}`)}>
            Сообщить об ошибке
          </button>
        </div>
        <p className="muted small">Кнопка откроет на GitHub новый отчёт с уже заполненным текстом ошибки и версией — останется описать, что вы делали.</p>
      </div>
    )
  }
}
