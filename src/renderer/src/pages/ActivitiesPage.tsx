import { useEffect, useMemo, useState } from 'react'
import { useIntel } from '../IntelContext'
import { Card, Empty, Stat, Tabs } from '../components/ui'
import { locale } from '../i18n'

type Tab = 'sigs'

export default function ActivitiesPage() {
  const [tab, setTab] = useState<Tab>('sigs')
  return (
    <div className="page">
      <Tabs tabs={[{ id: 'sigs', label: 'Сигнатуры' }]} value={tab} onChange={setTab} />
      {tab === 'sigs' && <Signatures />}
    </div>
  )
}

// ---------------- Probe scanner signatures ----------------

type SigKind = 'data' | 'relic' | 'gas' | 'wormhole' | 'combat' | 'ore' | 'unknown'

interface Sig {
  id: string
  group: string
  type: string
  name: string
  strength: number
  distance: string
  kind: SigKind
  anomaly: boolean
}

const KIND_LABEL: Record<SigKind, string> = {
  data: 'Данные',
  relic: 'Реликвии',
  gas: 'Газ',
  wormhole: 'Вормхол',
  combat: 'Боевой',
  ore: 'Руда',
  unknown: 'Не определено'
}

/** Signature type from the scanner's "type" column, English or Russian client. */
function kindOf(type: string, name: string): SigKind {
  const t = `${type} ${name}`
  if (/wormhole|червоточ/i.test(t)) return 'wormhole'
  if (/data|данн/i.test(t)) return 'data'
  if (/relic|рели[кв]/i.test(t)) return 'relic'
  if (/gas|газ/i.test(t)) return 'gas'
  if (/ore|руд|астероид/i.test(t)) return 'ore'
  if (/combat|боев/i.test(t)) return 'combat'
  return 'unknown'
}

/** Probe scanner copy: ID, group, type, name, signal strength, distance (tab separated). */
function parseSigs(text: string): Sig[] {
  const out: Sig[] = []
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t').map((x) => x.trim())
    if (!/^[A-Z]{3}-\d{3}$/.test(c[0] ?? '')) continue
    const [id, group = '', type = '', name = '', strength = '0', distance = ''] = c
    out.push({
      id,
      group,
      type,
      name,
      strength: Number(strength.replace('%', '').replace(',', '.')) || 0,
      distance,
      kind: kindOf(type, name),
      anomaly: /anomal|аномал/i.test(group)
    })
  }
  return out
}

/** What to expect at a site, from its name (tiers of data / relic sites, NPC hazards). */
function hint(s: Sig): { text: string; level: 'low' | 'mid' | 'high' | 'warn' } | null {
  const n = s.name
  if (s.kind === 'wormhole') return { text: 'Код дыры виден после варпа — проверьте его во вкладке «Карта → Вормхолы»', level: 'mid' }
  if (!n) return null
  if (/covert research|ghost|скрыт.*исследов/i.test(n)) return { text: 'Ghost site: вскоре после начала взлома прилетят NPC, неудачный взлом взрывает контейнер', level: 'warn' }
  if (/forgotten|unsecured|sleeper|забыт|незащищ/i.test(n)) return { text: 'Сайт Sleeper: высокая ценность, часто охраняется дронами Sleeper', level: 'high' }
  if (s.kind === 'data' || s.kind === 'relic') {
    if (/^(local|crumbling|местн|рассыпа)/i.test(n)) return { text: 'Низкий уровень: мало ценностей', level: 'low' }
    if (/^(regional|decayed|регион|разлага)/i.test(n)) return { text: 'Средний уровень', level: 'mid' }
    if (/^(central|ruined|централ|разрушен)/i.test(n)) return { text: 'Высокий уровень: самые ценные контейнеры', level: 'high' }
  }
  if (s.kind === 'gas') {
    if (/perimeter|frontier|core|periphery|reservoir|периметр|фронт|ядро|резерв/i.test(n)) return { text: 'Газ в червоточине: примерно через 15–20 минут прилетят Sleeper’ы', level: 'warn' }
    if (/nebula|туманн/i.test(n)) return { text: 'Бустерный газ (туманность)', level: 'mid' }
  }
  if (s.kind === 'combat') return { text: 'Боевой сайт: может дать эскалацию (DED)', level: 'mid' }
  return null
}

const storeKey = (system: string) => `canopus.sigs.${system}`

function loadSaved(system: string): Sig[] {
  try {
    return JSON.parse(localStorage.getItem(storeKey(system)) ?? '[]')
  } catch {
    return []
  }
}

function saveSigs(system: string, sigs: Sig[]): void {
  try {
    localStorage.setItem(storeKey(system), JSON.stringify(sigs))
  } catch {
    // storage unavailable: history just isn't kept
  }
}

interface Snapshot {
  sigs: Sig[]
  system: string
  at: number
  added: Set<string>
  gone: Sig[]
}

function Signatures() {
  const { probe, system } = useIntel()
  const [text, setText] = useState('')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [showAnomalies, setShowAnomalies] = useState(false)

  function apply(raw: string, sysName: string | null) {
    const sigs = parseSigs(raw)
    if (!sigs.length) return
    const key = sysName ?? 'unknown'
    const prev = loadSaved(key)
    const prevById = new Map(prev.map((s) => [s.id, s]))
    // A partial rescan keeps what an earlier, stronger scan already revealed.
    const merged = sigs.map((s) => {
      const p = prevById.get(s.id)
      return p && p.strength > s.strength && !s.name ? { ...s, type: p.type || s.type, name: p.name, kind: p.kind, strength: p.strength } : s
    })
    const now = new Set(merged.map((s) => s.id))
    setSnap({
      sigs: merged,
      system: key,
      at: Date.now(),
      added: new Set(prev.length ? merged.filter((s) => !prevById.has(s.id)).map((s) => s.id) : []),
      gone: prev.filter((s) => !now.has(s.id))
    })
    saveSigs(key, merged)
  }

  // New probe scanner copies from the game arrive through the clipboard watcher.
  useEffect(() => {
    if (probe) apply(probe.text, probe.system)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe?.at])

  const shown = useMemo(() => (snap?.sigs ?? []).filter((s) => showAnomalies || !s.anomaly).sort((a, b) => a.kind.localeCompare(b.kind) || b.strength - a.strength), [snap, showAnomalies])
  const counts = useMemo(() => {
    const m = new Map<SigKind, number>()
    for (const s of snap?.sigs ?? []) if (!s.anomaly) m.set(s.kind, (m.get(s.kind) ?? 0) + 1)
    return m
  }, [snap])
  const scanned = (snap?.sigs ?? []).filter((s) => !s.anomaly && s.strength >= 100).length
  const total = (snap?.sigs ?? []).filter((s) => !s.anomaly).length

  return (
    <>
      <Card>
        <p className="muted small">
          В игре: окно сканера зондов → <b>Ctrl+A</b>, <b>Ctrl+C</b>. Canopus разберёт сигнатуры автоматически, запомнит их для системы и при следующем копировании покажет новые и
          исчезнувшие. Или вставьте вручную:
        </p>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="ABC-123	Cosmic Signature	Data Site	Central Guristas Survey Site	100,0%	3,44 AU" />
        <div className="row">
          <button disabled={!text.trim()} onClick={() => apply(text, system?.name ?? null)}>
            Разобрать
          </button>
          <span className="muted small">{`Система: ${system?.name ?? 'неизвестна (нет лога Local)'}`}</span>
        </div>
      </Card>
      {!snap ? (
        <Empty>Скопируйте результаты сканера зондов в игре.</Empty>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Сигнатур" value={total} sub={`просканировано полностью: ${scanned}`} />
            <Stat label="Новых" value={<span className={snap.added.size ? 'bad' : ''}>{snap.added.size}</span>} sub="с прошлого копирования" />
            <Stat label="Исчезло" value={snap.gone.length} sub={snap.gone.map((g) => g.id).join(', ') || '—'} />
            <Stat
              label="По типам"
              value={<span className="small">{[...counts.entries()].map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(' · ') || '—'}</span>}
              sub={snap.system}
            />
          </div>
          <Card
            actions={
              <label className="check small">
                <input type="checkbox" checked={showAnomalies} onChange={(e) => setShowAnomalies(e.target.checked)} />
                Показывать аномалии
              </label>
            }
          >
            <table className="table compact sig-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Тип</th>
                  <th>Название</th>
                  <th className="num">Сигнал</th>
                  <th className="num">Дистанция</th>
                  <th>Что ждать</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const h = hint(s)
                  return (
                    <tr key={s.id} className={snap.added.has(s.id) ? 'arrived' : ''}>
                      <td className="mono">
                        {s.id}
                        {snap.added.has(s.id) && <span className="new-badge">новая</span>}
                      </td>
                      <td>
                        <span className={`sig-kind sig-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                      </td>
                      <td translate="no">{s.name || <span className="muted">—</span>}</td>
                      <td className="num">
                        <div className="sig-strength">
                          <div style={{ width: `${Math.min(100, s.strength)}%` }} />
                        </div>
                        {`${s.strength.toLocaleString(locale(), { maximumFractionDigits: 1 })}%`}
                      </td>
                      <td className="num muted" translate="no">
                        {s.distance}
                      </td>
                      <td className={`small sig-hint-${h?.level ?? ''}`}>{h?.text ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  )
}
