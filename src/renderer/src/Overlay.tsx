import { useEffect, useState } from 'react'
import type { OverlaySummary, Threat } from '../../shared/intel'
import type { Settings } from '../../shared/types'
import { THREAT_LABEL } from './lib/intel'
import { secColor, roundSec } from './lib/format'
import { useTypeBasic } from './lib/sde'
import { setUiLang, translate } from './i18n'

const SHOWN: Threat[] = ['hostile', 'high', 'medium', 'unknown', 'low', 'friendly']

/** The ship the pilot has been flying most lately (from zKillboard). */
function ShipName({ id }: { id: number }) {
  const basic = useTypeBasic(id)
  return basic ? <span className="ov-ship">{basic.n[0]}</span> : null
}

/** Always-on-top window over the game with the latest Local scan. */
export default function Overlay() {
  const [s, setS] = useState<OverlaySummary | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    void window.api.intel.lastSummary().then(setS)
    void window.api.settings.get().then((st) => {
      setUiLang(st.lang === 'en' ? 'en' : 'ru')
      setSettings(st)
    })
    // Settings (alert radius, click-through) may change in the main window: re-read with each update.
    const off = window.api.intel.onSummary((next) => {
      setS(next)
      void window.api.settings.get().then(setSettings)
    })
    const t = setInterval(() => tick((x) => x + 1), 10_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  const clickThrough = settings?.intel.overlay.clickThrough ?? false
  const toggleClickThrough = async () => {
    await window.api.intel.setOverlay({ clickThrough: !clickThrough })
    setSettings(await window.api.settings.get())
  }

  const agoMin = s?.scannedAt ? Math.floor((Date.now() - new Date(s.scannedAt).getTime()) / 60_000) : null
  const alertJumps = settings?.intel.channelJumps ?? -1
  const reports = s?.reports ?? []
  const nearReport = reports.some((r) => !r.clear && r.jumps <= alertJumps)
  const danger = (s?.counts.hostile ?? 0) + (s?.counts.high ?? 0) + (nearReport ? 1 : 0)
  const reportList = reports.length > 0 && (
    <ul className="ov-reports">
      {reports.map((r) => {
        const min = Math.floor((Date.now() - new Date(r.at).getTime()) / 60_000)
        return (
          <li key={r.id} className={r.clear ? 'clear' : r.jumps <= alertJumps ? 'near' : ''} title={r.text} translate="no">
            <span className="ov-report-sys">{r.system}</span>
            <span className="ov-report-jumps">{r.jumps === 0 ? translate('здесь') : `${r.jumps}j`}</span>
            <span className="ov-report-text">{r.clear ? translate('чисто') : r.text}</span>
            <span className="ov-report-ago">{min < 1 ? translate('сейчас') : `${min}m`}</span>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className={`ov ${danger ? 'ov-danger' : ''}`}>
      <div className="ov-head">
        <span className="ov-system">
          {s?.security !== null && s?.security !== undefined && <b style={{ color: secColor(s.security) }}>{roundSec(s.security).toFixed(1)} </b>}
          {s?.system ?? 'Canopus'}
        </span>
        <span className="ov-actions">
          <button title="Сквозные клики (Ctrl+Shift+K)" className={clickThrough ? 'on' : ''} onClick={toggleClickThrough}>
            ⇄
          </button>
          <button title="Скрыть оверлей (Ctrl+Shift+L)" onClick={() => void window.api.intel.setOverlay({ enabled: false })}>
            ✕
          </button>
        </span>
      </div>
      {reportList}
      {!s || !s.total ? (
        <div className="ov-empty">
          Скопируйте Local в игре
          <br />
          (Ctrl+A, Ctrl+C)
        </div>
      ) : (
        <>
          <div className="ov-counts">
            <span>{s.total} в локале</span>
            {SHOWN.filter((t) => s.counts[t] && t !== 'unknown' && t !== 'low').map((t) => (
              <span key={t} className={`threat threat-${t}`}>
                {THREAT_LABEL[t]} {s.counts[t]}
              </span>
            ))}
            {s.left > 0 && <span className="muted">ушли {s.left}</span>}
          </div>
          {s.stale && <div className="ov-stale">Система сменилась — скопируйте Local заново</div>}
          <ul className="ov-list">
            {s.pilots.map((p) => (
              <li key={p.id} className={`ov-pilot t-${p.threat} ${p.isNew ? 'new' : ''}`}>
                <i className={`ov-dot ov-dot-${p.threat}`} />
                <span className="ov-name">{p.name}</span>
                {p.ticker && <span className="ov-ticker">{p.ticker}</span>}
                {p.shipTypeId && <ShipName id={p.shipTypeId} />}
              </li>
            ))}
          </ul>
          <div className="ov-foot">{agoMin === null ? '' : agoMin === 0 ? 'скан только что' : `скан ${agoMin} мин назад`}</div>
        </>
      )}
    </div>
  )
}
