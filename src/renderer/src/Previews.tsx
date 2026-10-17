// Multi-client previews window: a live tile per EVE client (window capture, a few frames a second),
// click a tile to bring that client to the front. The list follows clients opening and closing.

import { useEffect, useRef, useState } from 'react'
import type { ClientWindow, PreviewSettings } from '../../shared/previews'
import { setUiLang, translate } from './i18n'

const LIST_EVERY_MS = 3000

export default function Previews() {
  const [clients, setClients] = useState<ClientWindow[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [cfg, setCfg] = useState<PreviewSettings | null>(null)
  const [perm, setPerm] = useState<{ screen: string; accessibility: boolean } | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    const loadCfg = () =>
      void window.api.settings.get().then((s) => {
        setUiLang(s.lang === 'en' ? 'en' : 'ru')
        setCfg(s.previews)
      })
    loadCfg()
    void window.api.previews.permissions().then(setPerm)
    const list = () => void window.api.previews.list().then(setClients).catch(() => {})
    list()
    const t = setInterval(list, LIST_EVERY_MS)
    const offActive = window.api.previews.onActive(setActive)
    const offSettings = window.api.previews.onSettings(loadCfg)
    return () => {
      clearInterval(t)
      offActive()
      offSettings()
    }
  }, [])

  const pick = (c: ClientWindow) => {
    setActive(c.id)
    void window.api.previews.activate(c)
  }

  return (
    <div className="ov previews">
      <div className="ov-head">
        <span className="ov-system">{translate('Клиенты EVE')}</span>
        <span className="ov-actions">
          <button title={translate('Скрыть')} onClick={() => void window.api.previews.set({ enabled: false })}>
            ✕
          </button>
        </span>
      </div>
      {!clients.length ? (
        <div className="widget-body muted">
          {translate('Клиенты EVE не найдены. Окна клиентов называются «EVE - имя персонажа» — запустите игру и войдите персонажем.')}
          {perm && perm.screen !== 'granted' && (
            <div className="bad">{translate('macOS: разрешите Canopus запись экрана — Системные настройки → Конфиденциальность и безопасность → Запись экрана.')}</div>
          )}
        </div>
      ) : (
        <div className="preview-tiles">
          {clients.map((c) => (
            <Tile key={c.id} client={c} width={cfg?.tile ?? 240} fps={cfg?.fps ?? 5} active={c.id === active} onPick={() => pick(c)} />
          ))}
        </div>
      )}
      {perm && !perm.accessibility && clients.length > 0 && (
        <div className="muted small preview-hint">{translate('macOS: для переключения клиентов разрешите Canopus «Универсальный доступ» в настройках конфиденциальности.')}</div>
      )}
    </div>
  )
}

/** One client: its window as live video, the character's name, click to switch to it. */
function Tile({ client, width, fps, active, onPick }: { client: ClientWindow; width: number; fps: number; active: boolean; onPick: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let stream: MediaStream | null = null
    let alive = true
    const constraints = {
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: client.id, maxWidth: width * 2, maxFrameRate: fps } }
    } as unknown as MediaStreamConstraints
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) {
          video.current.srcObject = s
          void video.current.play()
        }
      })
      .catch(() => setFailed(true))
    return () => {
      alive = false
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [client.id, width, fps])
  return (
    <button className={`preview-tile ${active ? 'active' : ''}`} style={{ width }} onClick={onPick} title={client.title}>
      {failed ? <div className="preview-fail muted small">{translate('Нет доступа к окну')}</div> : <video ref={video} muted playsInline />}
      <span className="preview-name" translate="no">
        {client.character}
      </span>
    </button>
  )
}
