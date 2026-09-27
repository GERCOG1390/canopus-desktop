import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChannelInfo, ClipboardKind, IntelReport, LogEvent, OverlayReport, OverlaySummary, Threat } from '../../shared/intel'
import type { SystemBasic } from '../../shared/sde'
import { useApp } from './AppContext'
import { loadMe, parseDscan, parseLocalList, scanPilots, sortPilots, THREAT_LABEL, THREAT_ORDER, type Me, type PilotIntel, type ScanRow } from './lib/intel'
import { requestBasics } from './lib/sde'
import { translate } from './i18n'

export interface LocalScan {
  pilots: PilotIntel[]
  unknown: string[]
  scannedAt: number
  system: string | null
  running: boolean
  /** IDs that were not in the previous scan of the same system */
  arrived: Set<number>
  /** Names that left since the previous scan */
  left: string[]
}

export interface FleetRow {
  pilot: string
  typeId: number | null
}

interface IntelState {
  system: { name: string; id?: number; sec?: number; since: string } | null
  logStatus: { file: string | null; dir: string | null; error?: string } | null
  scan: LocalScan | null
  dscan: { rows: ScanRow[]; at: number } | null
  fleet: { rows: FleetRow[]; at: number } | null
  lastClipboard: { kind: ClipboardKind; at: number } | null
  /** Last probe scanner copy (signatures), with the system it was made in */
  probe: { text: string; at: number; system: string | null } | null
  scanText: (text: string) => void
  setDscanText: (text: string) => void
  setFleetText: (text: string) => Promise<void>
  /** Messages from watched intel channels, oldest first */
  reports: IntelReport[]
  channels: ChannelInfo[]
  /** Jumps from the current system to systems mentioned in reports */
  jumps: Record<number, number>
  systems: Record<number, SystemBasic>
}

const MAX_REPORTS = 300
/** Reports older than this are not "active" (overlay, nearest-threat summary). */
export const REPORT_FRESH_MS = 15 * 60_000

const Ctx = createContext<IntelState | null>(null)
const THREAT_RANK: Record<Threat, number> = { hostile: 4, high: 3, medium: 2, low: 1, friendly: 0, unknown: 0 }
const ALERT_RANK = { off: 99, hostile: 4, high: 3, medium: 2 }

function beep(): void {
  try {
    const ctx = new AudioContext()
    for (const [i, freq] of [880, 660].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.18)
      osc.stop(ctx.currentTime + i * 0.18 + 0.17)
    }
  } catch {
    // Audio is a nicety.
  }
}

export function IntelProvider({ children }: { children: ReactNode }) {
  const { active, settings } = useApp()
  const [system, setSystem] = useState<IntelState['system']>(null)
  const [logStatus, setLogStatus] = useState<IntelState['logStatus']>(null)
  const [scan, setScan] = useState<LocalScan | null>(null)
  const [dscan, setDscan] = useState<IntelState['dscan']>(null)
  const [fleet, setFleet] = useState<IntelState['fleet']>(null)
  const [lastClipboard, setLastClipboard] = useState<IntelState['lastClipboard']>(null)
  const [probe, setProbe] = useState<IntelState['probe']>(null)
  const [reports, setReports] = useState<IntelReport[]>([])
  const [channels, setChannels] = useState<ChannelInfo[]>([])
  const [jumps, setJumps] = useState<Record<number, number>>({})
  const [systems, setSystems] = useState<Record<number, SystemBasic>>({})
  const me = useRef<Me | null>(null)
  const scanSeq = useRef(0)
  const scanRef = useRef<LocalScan | null>(null)
  const systemRef = useRef<IntelState['system']>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  scanRef.current = scan
  systemRef.current = system

  // Who am I (for friend/foe) — reloaded when the active character changes.
  useEffect(() => {
    me.current = null
    if (active) void loadMe(active.id).then((m) => (me.current = m))
  }, [active?.id])

  const alert = useCallback((pilots: PilotIntel[], arrived: Set<number>) => {
    const intel = settingsRef.current?.intel
    if (!intel || intel.alertLevel === 'off') return
    const bad = pilots.filter((p) => arrived.has(p.id) && THREAT_RANK[p.threat] >= ALERT_RANK[intel.alertLevel])
    if (!bad.length) return
    const where = systemRef.current?.name ? ` в ${systemRef.current.name}` : ''
    void window.api.intel.notify(
      translate(`Опасность${where}: ${bad.length}`),
      bad
        .slice(0, 5)
        .map((p) => `${p.name}${p.allianceTicker ? ` <${p.allianceTicker}>` : p.corpTicker ? ` [${p.corpTicker}]` : ''} — ${translate(THREAT_LABEL[p.threat])}`)
        .join('\n')
    )
    if (intel.sound) beep()
  }, [])

  const scanText = useCallback(
    (text: string) => {
      const names = parseLocalList(text)
      if (!names.length) return
      const seq = ++scanSeq.current
      const prev = scanRef.current
      const sys = systemRef.current?.name ?? null
      const sameSystem = !!prev && prev.system === sys
      const prevIds = new Set(prev?.pilots.filter((p) => p.source === 'local').map((p) => p.id))
      const arrivedOf = (list: PilotIntel[]) => new Set(sameSystem ? list.filter((p) => !prevIds.has(p.id)).map((p) => p.id) : [])
      const leftOf = (list: PilotIntel[]) => {
        if (!sameSystem) return []
        const now = new Set(list.map((p) => p.id))
        return prev!.pilots.filter((p) => p.source === 'local' && !now.has(p.id)).map((p) => p.name)
      }
      setScan({ pilots: [], unknown: [], scannedAt: Date.now(), system: sys, running: true, arrived: new Set(), left: [] })
      void scanPilots(
        names,
        'local',
        me.current,
        (pilots) => setScan((s) => (s && seq === scanSeq.current ? { ...s, pilots, arrived: arrivedOf(pilots), left: leftOf(pilots) } : s)),
        () => seq !== scanSeq.current
      )
        .then(({ pilots, unknown }) => {
          if (seq !== scanSeq.current) return
          const arrived = arrivedOf(pilots)
          setScan((s) => (s ? { ...s, pilots, unknown, running: false, arrived, left: leftOf(pilots) } : s))
          alert(pilots, arrived)
        })
        .catch(() => setScan((s) => (s ? { ...s, running: false } : s)))
    },
    [alert]
  )

  /** A pilot spoke in Local: add them to the current scan. */
  const addSpeaker = useCallback((name: string) => {
    const current = scanRef.current
    if (!settingsRef.current?.intel.scanSpeakers || !current || current.running) return
    if (current.pilots.some((p) => p.name.toLowerCase() === name.toLowerCase())) return
    if (active && name === active.name) return
    void scanPilots([name], 'chat', me.current, () => {}, () => false).then(({ pilots }) => {
      if (!pilots.length) return
      setScan((s) => (s ? { ...s, pilots: [...s.pilots.filter((p) => p.id !== pilots[0].id), ...pilots] } : s))
    })
  }, [active])

  const setDscanText = useCallback((text: string) => {
    const rows = parseDscan(text)
    requestBasics(rows.map((r) => r.typeId))
    setDscan({ rows, at: Date.now() })
  }, [])

  const setFleetText = useCallback(async (text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c.length >= 2)
    const cells = [...new Set(lines.flat().filter((c) => c && c.length < 60))]
    const ids = await window.api.intel.resolveTypeNames(cells)
    const basics = await window.api.sde.basics(Object.values(ids))
    const rows = lines.map((cols) => {
      const shipCell = cols.find((c) => ids[c] && basics[ids[c]]?.c === 6)
      return { pilot: cols[0], typeId: shipCell ? ids[shipCell] : null }
    })
    setFleet({ rows, at: Date.now() })
  }, [])

  /** A live report close enough to the current system raises an alert. */
  const reportAlert = useCallback(async (r: IntelReport) => {
    const intel = settingsRef.current?.intel
    const here = systemRef.current?.id
    if (!intel || intel.channelJumps < 0 || r.initial || r.clear || !r.systems.length || !here) return
    const dist = await window.api.intel.jumpsFrom(here, r.systems)
    const near = r.systems.filter((id) => dist[id] !== undefined && dist[id] <= intel.channelJumps).sort((a, b) => dist[a] - dist[b])
    if (!near.length) return
    const sys = await window.api.sde.system(near[0])
    const j = dist[near[0]]
    void window.api.intel.notify(
      translate(j === 0 ? `Разведка: ${sys?.n ?? '?'} — в вашей системе` : `Разведка: ${sys?.n ?? '?'} — ${j} прыж.`),
      `${r.speaker}: ${r.message}`.slice(0, 250)
    )
    if (intel.sound) beep()
  }, [])

  // Intel channel reports.
  useEffect(() => {
    // Reports have stable IDs: merge instead of appending, a log can be re-read after a restart.
    const merge = (list: IntelReport[], add: IntelReport[]) => {
      const seen = new Set(list.map((r) => r.id))
      const fresh = add.filter((r) => !seen.has(r.id))
      return fresh.length ? [...list, ...fresh].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_REPORTS) : list
    }
    const offReport = window.api.intel.onReport((r) => {
      setReports((list) => merge(list, [r]))
      void reportAlert(r)
    })
    void window.api.intel.recentReports().then((list) => setReports((cur) => merge(cur, list)))
    const offChannels = window.api.intel.onChannels(setChannels)
    void window.api.intel.channelStatus().then(setChannels)
    return () => {
      offReport()
      offChannels()
    }
  }, [reportAlert])

  // Distances and names for every system mentioned in the feed.
  const mentionedKey = [...new Set(reports.flatMap((r) => r.systems))].sort().join(',')
  useEffect(() => {
    const ids = mentionedKey ? mentionedKey.split(',').map(Number) : []
    const missing = ids.filter((id) => !systems[id])
    if (missing.length)
      void Promise.all(missing.map((id) => window.api.sde.system(id))).then((list) =>
        setSystems((prev) => ({ ...prev, ...Object.fromEntries(list.filter(Boolean).map((s) => [s!.id, s!])) }))
      )
    if (system?.id && ids.length) void window.api.intel.jumpsFrom(system.id, ids).then(setJumps)
    else setJumps({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionedKey, system?.id])

  // Clipboard & log events from the main process.
  useEffect(() => {
    const offClip = window.api.intel.onClipboard((e) => {
      if (e.kind === 'probe') {
        setProbe({ text: e.text, at: Date.now(), system: systemRef.current?.name ?? null })
        return
      }
      setLastClipboard({ kind: e.kind, at: Date.now() })
      if (e.kind === 'local') scanText(e.text)
      else if (e.kind === 'dscan') setDscanText(e.text)
      else void setFleetText(e.text)
    })
    const offLog = window.api.intel.onLog((e: LogEvent) => {
      if (e.type === 'status') setLogStatus({ file: e.file, dir: e.dir, error: e.error })
      else if (e.type === 'system') {
        setSystem({ name: e.system, since: e.at })
        void window.api.sde.searchSystems(e.system, 5).then((r) => {
          const hit = r.find((s) => s.n.toLowerCase() === e.system.toLowerCase())
          if (hit) setSystem((s) => (s && s.name === e.system ? { ...s, id: hit.id, sec: hit.sec } : s))
        })
      } else if (e.type === 'speaker' && !e.initial) addSpeaker(e.name)
    })
    void window.api.intel.restartLog()
    return () => {
      offClip()
      offLog()
    }
  }, [scanText, setDscanText, setFleetText, addSpeaker])

  // Keep the overlay in sync.
  useEffect(() => {
    const pilots = scan ? sortPilots(scan.pilots) : []
    const counts = Object.fromEntries(THREAT_ORDER.map((t) => [t, pilots.filter((p) => p.threat === t).length])) as Record<Threat, number>
    const summary: OverlaySummary = {
      system: system?.name ?? null,
      security: system?.sec ?? null,
      scannedAt: scan ? new Date(scan.scannedAt).toISOString() : null,
      stale: !!scan && !!system && scan.system !== system.name,
      total: pilots.length,
      counts,
      left: scan?.left.length ?? 0,
      reports: nearbyReports(reports, jumps, systems),
      pilots: pilots.slice(0, 60).map((p) => ({
        id: p.id,
        name: p.name,
        ticker: p.allianceTicker ?? p.corpTicker ?? '',
        threat: p.threat,
        shipTypeId: p.zkb?.recentShips[0]?.typeId,
        isNew: scan!.arrived.has(p.id)
      }))
    }
    const t = setTimeout(() => void window.api.intel.publish(summary), 150)
    return () => clearTimeout(t)
  }, [scan, system, reports, jumps, systems])

  return <Ctx.Provider value={{ system, logStatus, scan, dscan, fleet, lastClipboard, probe, scanText, setDscanText, setFleetText, reports, channels, jumps, systems }}>{children}</Ctx.Provider>
}

/** Fresh reports within 10 jumps for the overlay: nearest system of each, newest first. */
function nearbyReports(reports: IntelReport[], jumps: Record<number, number>, systems: Record<number, SystemBasic>): OverlayReport[] {
  const out: OverlayReport[] = []
  const fresh = Date.now() - REPORT_FRESH_MS
  for (let i = reports.length - 1; i >= 0 && out.length < 6; i--) {
    const r = reports[i]
    if (new Date(r.at).getTime() < fresh) break
    const near = r.systems.filter((id) => jumps[id] !== undefined && jumps[id] <= 10).sort((a, b) => jumps[a] - jumps[b])[0]
    if (near === undefined) continue
    out.push({ id: r.id, at: r.at, system: systems[near]?.n ?? '?', jumps: jumps[near], clear: r.clear, text: `${r.speaker}: ${r.message}`.slice(0, 120) })
  }
  return out
}

export function useIntel(): IntelState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useIntel outside IntelProvider')
  return ctx
}
