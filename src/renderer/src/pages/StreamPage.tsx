// Streamer mode: turn the widget server on, pick the character and the location delay, copy the
// widget URLs into OBS (Browser source) and see them live.

import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { Card } from '../components/ui'
import { STREAM_WIDGETS, type StreamSettings, type StreamStatus, type StreamWidget } from '../../../shared/stream'

const WIDGET_INFO: Record<StreamWidget, [string, string, number]> = {
  ship: ['Корабль', 'Текущий корабль с картинкой и его название.', 90],
  system: ['Система', 'Система, безопасность и регион — с задержкой из настроек.', 80],
  session: ['Сессия', 'Изменение кошелька, убийства и потери с начала сессии.', 80],
  killfeed: ['Лента убийств', 'Последние убийства и потери с zKillboard. Параметр ?n=8 — сколько строк.', 200]
}

export default function StreamPage() {
  const { settings, updateSettings, characters } = useApp()
  const [status, setStatus] = useState<StreamStatus>({ running: false, url: null, error: null })
  const [copied, setCopied] = useState<string | null>(null)
  const [port, setPort] = useState('')
  useEffect(() => {
    void window.api.stream.status().then(setStatus)
    return window.api.stream.onStatus(setStatus)
  }, [])
  useEffect(() => setPort(String(settings?.stream.port ?? '')), [settings?.stream.port])
  if (!settings) return null
  const s = settings.stream
  const set = (patch: Partial<StreamSettings>) => updateSettings({ stream: { ...s, ...patch } })
  const copy = (url: string) => {
    void navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="page">
      <Card title="Режим стримера">
        <p className="muted small">
          Canopus показывает виджеты для OBS: добавьте ссылку как источник «Браузер». Сервер доступен только на этом компьютере (127.0.0.1). Фон у виджетов прозрачный.
        </p>
        <label className="check">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Включить виджеты
        </label>
        <div className="row">
          <label>
            Персонаж
            <select value={s.characterId ?? ''} onChange={(e) => set({ characterId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Активный персонаж</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Показывать систему
            <select value={s.locationDelayMin} onChange={(e) => set({ locationDelayMin: Number(e.target.value) })}>
              <option value={0}>Сразу</option>
              <option value={2}>С задержкой 2 мин</option>
              <option value={5}>С задержкой 5 мин</option>
              <option value={15}>С задержкой 15 мин</option>
              <option value={30}>С задержкой 30 мин</option>
              <option value={60}>С задержкой 60 мин</option>
              <option value={-1}>Не показывать</option>
            </select>
          </label>
          <label>
            Порт
            <input
              className="stream-port"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              onBlur={() => {
                const p = Number(port)
                if (p >= 1024 && p <= 65535 && p !== s.port) set({ port: p })
                else setPort(String(s.port))
              }}
            />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.showWallet} onChange={(e) => set({ showWallet: e.target.checked })} />
          Показывать изменение кошелька за сессию
        </label>
        <div className="row">
          {status.running ? <span className="good small">{`Работает: ${status.url}`}</span> : status.error ? <span className="bad small">{status.error}</span> : <span className="muted small">Выключено</span>}
          <button className="ghost" disabled={!s.enabled} onClick={() => void window.api.stream.resetSession()} title="Счётчики кошелька и убийств — с нуля">
            Новая сессия
          </button>
        </div>
        <p className="muted small">Задержка системы защищает от «стрим-снайпинга»: зрители не увидят, где вы сейчас.</p>
      </Card>

      {status.running && status.url && (
        <div className="stream-widgets">
          {STREAM_WIDGETS.map((w) => {
            const url = `${status.url}/w/${w}`
            const [title, hint, height] = WIDGET_INFO[w]
            return (
              <Card
                key={w}
                title={title}
                actions={
                  <button className="ghost small" onClick={() => copy(url)}>
                    {copied === url ? 'Скопировано' : 'Копировать ссылку'}
                  </button>
                }
              >
                <code className="small" translate="no">
                  {url}
                </code>
                <p className="muted small">{hint}</p>
                <iframe className="stream-preview" src={url} title={title} style={{ height }} />
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
