// One kill from the radar as a card that reads at a glance: the lost ship (icon, class, value), where
// (security, system, jumps, gate), how it was done (camp / bubbles / smartbombs) and by whom (alliance or
// corporation, their ships and weapons). Used by the intel overlay, the radar mini-window and the Intel page.

import type { RadarKill, RadarOrg } from '../../../shared/radar'
import { imageUrl } from '../lib/esi'
import { fmtIsk, roundSec, secColor } from '../lib/format'

const logo = (o: RadarOrg) => (o.kind === 'alliance' ? imageUrl.allianceLogo(o.id, 32) : imageUrl.corpLogo(o.id, 32))

function Ago({ time, now }: { time: string; now: number }) {
  const min = Math.max(0, Math.floor((now - Date.parse(time)) / 60_000))
  return <span className={`rk-ago ${min < 5 ? 'fresh' : ''}`}>{min < 1 ? 'сейчас' : `${min} мин`}</span>
}

function Jumps({ k }: { k: RadarKill }) {
  if (k.jumps === undefined) return <span className="rk-jumps route">на маршруте</span>
  if (k.jumps === 0) return <span className="rk-jumps here">ЗДЕСЬ</span>
  return <span className={`rk-jumps ${k.jumps === 1 ? 'near' : ''}`}>{`${k.jumps} пр.`}</span>
}

/** A type icon with a "×n" badge when several flew / used it. */
function Icon({ id, n, name }: { id: number; n?: number; name: string }) {
  return (
    <span className="rk-icon" title={n && n > 1 ? `${n}× ${name}` : name}>
      <img src={imageUrl.typeIcon(id, 32)} width={22} height={22} alt="" loading="lazy" />
      {!!n && n > 1 && <span className="rk-badge">{n}</span>}
    </span>
  )
}

export function RadarCard({ k, now = Date.now(), compact = false }: { k: RadarKill; now?: number; compact?: boolean }) {
  const danger = k.camp || k.bubbles || k.smartbombs
  const zkill = `https://zkillboard.com/kill/${k.id}/`
  return (
    <div className={`rk ${danger ? 'rk-danger' : ''} ${compact ? 'rk-compact' : ''}`}>
      <a className="rk-victim" href={zkill} target="_blank" rel="noreferrer" title="zKillboard">
        <img src={imageUrl.typeIcon(k.victimShip, 64)} width={compact ? 36 : 44} height={compact ? 36 : 44} alt="" loading="lazy" />
      </a>
      <div className="rk-body">
        <div className="rk-line">
          <b className="rk-ship" translate="no">
            {k.victimShipName}
          </b>
          {k.victimGroup && (
            <span className="rk-dim" translate="no">
              {k.victimGroup}
            </span>
          )}
          <span className="grow" />
          <span className="rk-isk">{fmtIsk(k.value, true)}</span>
          <Ago time={k.time} now={now} />
        </div>
        <div className="rk-line">
          <b style={{ color: secColor(k.security) }}>{roundSec(k.security).toFixed(1)}</b>
          <b translate="no">{k.system}</b>
          <Jumps k={k} />
          {k.gate && (
            <span className="rk-gate" translate="no">
              {`⇢ ${k.gate.toName}`}
            </span>
          )}
          {k.victimOrg && !compact && (
            <span className="rk-dim rk-org" translate="no">
              <img src={logo(k.victimOrg)} width={14} height={14} alt="" loading="lazy" />
              {k.victimOrg.name}
            </span>
          )}
        </div>
        {danger && (
          <div className="rk-line">
            {k.camp && <span className="rk-flag camp">КЕМП НА ГЕЙТЕ</span>}
            {k.bubbles && <span className="rk-flag bubble">БУБЛИ</span>}
            {k.smartbombs && <span className="rk-flag bomb">СМАРТБОМБЫ</span>}
          </div>
        )}
        <div className="rk-line rk-killers">
          <span className="rk-sword" title="Атакующие">
            ⚔
          </span>
          {(k.killers ?? []).map((o) => (
            <span key={o.id} className="rk-org" translate="no" title={o.name}>
              <img src={logo(o)} width={16} height={16} alt="" loading="lazy" />
              <span className="rk-org-name">{o.name || '—'}</span>
              {o.n > 1 && <span className="rk-dim">{`×${o.n}`}</span>}
            </span>
          ))}
          <span className="rk-dim">{`${k.attackers} пил.`}</span>
        </div>
        {(!!k.attackerTypes?.length || !!k.weapons?.length) && (
          <div className="rk-line rk-icons">
            {(k.attackerTypes ?? []).slice(0, compact ? 4 : 6).map((t) => (
              <Icon key={t.id} id={t.id} n={t.n} name={t.name} />
            ))}
            {!!k.weapons?.length && <span className="rk-sep" />}
            {(k.weapons ?? []).slice(0, compact ? 2 : 4).map((t) => (
              <Icon key={t.id} id={t.id} n={t.n} name={t.name} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
