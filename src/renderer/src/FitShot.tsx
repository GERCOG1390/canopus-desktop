// Fit snapshot window: the whole fit on one card — every module, drones and implants, and the stats
// they give — sized to fit without scrolling, to copy as a picture or save as PNG.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FitStats, Slot } from '../../shared/fit'
import type { FitShotData } from '../../shared/types'
import { AppProvider, useLang } from './AppContext'
import { AttrIcon } from './components/Icon'
import { imageUrl } from './lib/esi'
import { fmtNum } from './lib/format'
import { SLOT_LABEL, SLOT_ORDER } from './lib/fitting'
import { tn, useTypeBasics } from './lib/sde'
import { locale, translate } from './i18n'

const SLOT_ATTR: Record<Slot, number> = { hi: 14, med: 13, lo: 12, rig: 1137, sub: 1367 }
const RESIST_ICONS = [271, 274, 273, 272]
const LAYERS = [
  { key: 'shield', name: 'Щит', icon: 263 },
  { key: 'armor', name: 'Броня', icon: 265 },
  { key: 'hull', name: 'Корпус', icon: 9 }
] as const

const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const n2 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 2 })
const km = (m: number) => `${(m / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} км`

function capText(s: FitStats): string {
  if (s.capacitor.stable) return `стабилен ${Math.round((s.capacitor.stableLevel ?? 1) * 100)}%`
  const sec = Math.round(s.capacitor.lastsSec ?? 0)
  return `хватает на ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export default function FitShot() {
  return (
    <AppProvider>
      <Shot />
    </AppProvider>
  )
}

function Shot() {
  const [data, setData] = useState<FitShotData | null>(null)
  const [stats, setStats] = useState<FitStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const zoom = useRef(1)

  useEffect(() => {
    document.title = 'Canopus — снимок фита'
    document.documentElement.classList.add('fitshot-mode')
    void window.api.fitShot.get().then(setData)
    return window.api.fitShot.onFit(setData)
  }, [])
  useEffect(() => {
    if (!data) return
    setStats(null)
    window.api.fit
      .calculate(data.fit, data.skills)
      .then((s) => (setStats(s), setError(null)))
      .catch((e: Error) => setError(e.message))
  }, [data])

  // The window takes the card's size, so nothing needs scrolling and the picture has no gaps.
  useLayoutEffect(() => {
    const el = page.current
    if (!el) return
    // A fit too tall for the screen is scaled down as a whole, so the picture always shows all of it.
    const fit = () => {
      const r = el.getBoundingClientRect()
      const w = r.width / zoom.current
      const h = r.height / zoom.current
      const z = Math.min(1, (window.screen.availHeight - 60) / h)
      if (Math.abs(z - zoom.current) > 0.005) {
        zoom.current = z
        el.style.zoom = String(z)
      }
      void window.api.fitShot.resize(w * z, h * z)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [stats])

  const capture = async (to: 'clipboard' | 'file') => {
    const r = card.current?.getBoundingClientRect()
    if (!r || !data) return
    const ok = await window.api.fitShot.capture({ x: r.x, y: r.y, width: r.width, height: r.height }, to, data.fit.name)
    if (ok) {
      setStatus(translate(to === 'clipboard' ? 'Картинка скопирована' : 'Сохранено'))
      setTimeout(() => setStatus(null), 2500)
    }
  }

  return (
    <div className="fitshot-page" ref={page}>
      <div className="fitshot-toolbar">
        <button onClick={() => void capture('clipboard')} disabled={!stats}>
          Копировать картинку
        </button>
        <button className="ghost" onClick={() => void capture('file')} disabled={!stats}>
          Сохранить PNG
        </button>
        {status && <span className="good small">{status}</span>}
      </div>
      {error && <div className="warn-box">{error}</div>}
      {!data && <div className="muted">Откройте фит во вкладке «Фитинг» и нажмите «Снимок фита».</div>}
      {data && stats && (
        <div className="fitshot-card" ref={card}>
          <Card data={data} s={stats} />
        </div>
      )}
    </div>
  )
}

function Card({ data, s }: { data: FitShotData; s: FitStats }) {
  const lang = useLang()
  const f = data.fit
  const ids = [f.shipTypeId, ...f.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]), ...f.drones.map((d) => d.typeId), ...f.implants].filter(Boolean)
  const basic = useTypeBasics(ids)
  const name = (id: number) => tn(basic(id)?.n, lang)
  const d = s.defense
  const o = s.offense
  const nav = s.navigation
  const repair = d.shieldBoost + d.armorRepair + d.hullRepair

  return (
    <>
      <div className="fitshot-head">
        <img src={imageUrl.typeRender(f.shipTypeId, 128)} width={84} height={84} alt="" />
        <div className="grow">
          <div className="fitshot-ship" translate="no">
            {name(f.shipTypeId)}
          </div>
          <div className="fitshot-name" translate="no">
            {f.name}
          </div>
          <div className="muted small">{data.skills.mode === 'all5' ? 'Навыки: все V' : `Навыки: ${data.pilotName ?? 'персонаж'}`}</div>
        </div>
        <div className="fitshot-brand">Canopus</div>
      </div>

      <div className="fitshot-body">
        <div className="fitshot-modules">
          {SLOT_ORDER.map((slot) => {
            const mods = f.modules.filter((m) => m.slot === slot)
            const total = s.ship.slots[slot]
            if (!mods.length && !total) return null
            // Identical modules (same type, charge and state) as one line: "3× 200mm AutoCannon II".
            const groups: { m: (typeof mods)[number]; n: number }[] = []
            for (const m of mods) {
              const g = groups.find((x) => x.m.typeId === m.typeId && x.m.chargeTypeId === m.chargeTypeId && x.m.state === m.state)
              if (g) g.n++
              else groups.push({ m, n: 1 })
            }
            return (
              <div key={slot} className="fitshot-slot">
                <div className="fitshot-slot-head">
                  <AttrIcon attr={SLOT_ATTR[slot]} size={16} />
                  {SLOT_LABEL[slot]} <span className="muted">{`${mods.length}/${total}`}</span>
                </div>
                {groups.map(({ m, n }, i) => (
                  <div key={i} className={`fitshot-mod ${m.state === 'offline' ? 'off' : ''}`}>
                    <img src={imageUrl.typeIcon(m.typeId, 32)} width={22} height={22} alt="" />
                    <span translate="no">{`${n > 1 ? `${n}× ` : ''}${name(m.typeId)}`}</span>
                    {m.chargeTypeId ? (
                      <span className="fitshot-charge" translate="no">
                        <img src={imageUrl.typeIcon(m.chargeTypeId, 32)} width={16} height={16} alt="" />
                        {name(m.chargeTypeId)}
                      </span>
                    ) : null}
                    {m.state === 'offline' && <span className="muted small">{translate('выкл.')}</span>}
                    {m.state === 'overload' && <span className="bad small">{translate('перегрев')}</span>}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div className="fitshot-stats">
          <div className="fitshot-big">
            <div>
              <span>DPS</span>
              <b className="accent">{n1(o.totalDps)}</b>
              <small>{`залп ${fmtNum(o.totalVolley)}`}</small>
            </div>
            <div>
              <span>EHP</span>
              <b>{fmtNum(d.ehp)}</b>
              <small>{repair ? `ремонт ${n1(d.activeTankEhp)} EHP/с` : `${fmtNum(d.hp)} HP`}</small>
            </div>
            <div>
              <span>Скорость</span>
              <b>{`${fmtNum(nav.maxVelocity)} м/с`}</b>
              <small>{`разгон ${n2(nav.alignSec)} с`}</small>
            </div>
          </div>

          <table className="fitshot-resists">
            <thead>
              <tr>
                <th />
                {RESIST_ICONS.map((a) => (
                  <th key={a}>
                    <AttrIcon attr={a} size={16} />
                  </th>
                ))}
                <th className="num">HP</th>
              </tr>
            </thead>
            <tbody>
              {LAYERS.map((l) => (
                <tr key={l.key}>
                  <td>
                    <span className="with-icon">
                      <AttrIcon attr={l.icon} size={16} />
                      {l.name}
                    </span>
                  </td>
                  {d[l.key].resist.map((r, i) => (
                    <td key={i} className="num">
                      <span className="fitshot-res" style={{ ['--r' as string]: `${r * 100}%` }}>{`${Math.round(r * 100)}%`}</span>
                    </td>
                  ))}
                  <td className="num">{fmtNum(d[l.key].hp)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="fitshot-kv">
            <span>Накопитель</span>
            <b className={s.capacitor.stable ? 'good' : ''}>{`${fmtNum(s.capacitor.capacity)} GJ · ${capText(s)}`}</b>
            {o.weapons.length > 0 && (
              <>
                <span>Урон</span>
                <b>{[o.turretDps && `${translate('турели')} ${n1(o.turretDps)}`, o.missileDps && `${translate('ракеты')} ${n1(o.missileDps)}`, o.droneDps && `${translate('дроны')} ${n1(o.droneDps)}`].filter(Boolean).join(' · ')}</b>
              </>
            )}
            {repair > 0 && (
              <>
                <span>Ремонт</span>
                <b>
                  {[d.shieldBoost && `${translate('щит')} ${n1(d.shieldBoost)}`, d.armorRepair && `${translate('броня')} ${n1(d.armorRepair)}`, d.hullRepair && `${translate('корпус')} ${n1(d.hullRepair)}`]
                    .filter(Boolean)
                    .join(' · ') + ` ${translate('HP/с')}`}
                </b>
              </>
            )}
            <span>Сигнатура</span>
            <b>{`${n1(nav.signatureRadius)} м`}</b>
            <span>Варп</span>
            <b>{`${n2(nav.warpSpeed)} а.е./с`}</b>
            <span>Захват</span>
            <b>{`${km(s.targeting.maxRange)} · ${fmtNum(s.targeting.scanResolution)} мм · ${s.targeting.maxTargets} целей`}</b>
            <span>Сенсоры</span>
            <b>{`${n1(s.targeting.sensorStrength)} ${translate(s.targeting.sensorType)}`}</b>
            <span>Процессор</span>
            <b className={s.ship.cpu.used > s.ship.cpu.total ? 'bad' : ''}>{`${n1(s.ship.cpu.used)} / ${n1(s.ship.cpu.total)} tf`}</b>
            <span>Энергосеть</span>
            <b className={s.ship.power.used > s.ship.power.total ? 'bad' : ''}>{`${n1(s.ship.power.used)} / ${n1(s.ship.power.total)} MW`}</b>
            {s.ship.calibration.total > 0 && (
              <>
                <span>Калибровка</span>
                <b>{`${fmtNum(s.ship.calibration.used)} / ${fmtNum(s.ship.calibration.total)}`}</b>
              </>
            )}
          </div>
          {f.drones.length > 0 && (
            <div className="fitshot-slot fitshot-extra">
              <div className="fitshot-slot-head">
                Дроны <span className="muted">{`${fmtNum(s.ship.droneBay.used)}/${fmtNum(s.ship.droneBay.total)} м³`}</span>
              </div>
              {f.drones.map((x) => (
                <div key={x.typeId} className="fitshot-mod">
                  <img src={imageUrl.typeIcon(x.typeId, 32)} width={24} height={24} alt="" />
                  <span translate="no">{`${x.count}× ${name(x.typeId)}`}</span>
                  {x.active > 0 && x.active < x.count && <span className="muted small">{`запущено ${x.active}`}</span>}
                </div>
              ))}
            </div>
          )}
          {f.implants.length > 0 && (
            <div className="fitshot-slot fitshot-extra">
              <div className="fitshot-slot-head">Импланты</div>
              {f.implants.map((id) => (
                <div key={id} className="fitshot-mod">
                  <img src={imageUrl.typeIcon(id, 32)} width={24} height={24} alt="" />
                  <span translate="no">{name(id)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
