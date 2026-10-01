// 3D map of known space from the SDE's real coordinates: systems coloured by security, stargate
// links, region and system labels, kills in the last hour, a route, fresh intel reports and your
// current system. three.js / WebGL; labels are HTML placed over the canvas every frame.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GalaxyData } from '../../../shared/sde'
import { REPORT_FRESH_MS, useIntel } from '../IntelContext'
import { useApp } from '../AppContext'
import { Card, ErrorBox, Loading, SearchBox, Sec } from './ui'
import { searchSystemsSde, tn } from '../lib/sde'
import { secColor } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { esi } from '../lib/esi'
import { translate } from '../i18n'
import { GameButton } from './GameButton'
import { SCOPE, setDestinationInGame } from '../lib/gameActions'

/** How many system names to show when zoomed in, nearest to the centre of the view first. */
const SYSTEM_LABELS = 40
/** Camera distance (ly) below which system names appear. */
const SYSTEM_LABEL_DIST = 28
const PICK_PX = 10
/** ESI refreshes system kills hourly; checking more often only catches the update sooner. */
const KILLS_REFRESH_MS = 10 * 60_000

type Flag = 'secure' | 'shortest' | 'insecure'
interface Kills {
  ship: number
  pod: number
  npc: number
}
const pvp = (k: Kills | undefined) => (k ? k.ship + k.pod : 0)

const BRIDGES_KEY = 'galaxy-bridges'
/** The player's Ansiblex network: the pasted text, the parsed pairs and the alliance capital. */
const SYSTEMS_KEY = 'galaxy-systems'
/** The player's own marks on systems: avoided by routes, and free-text notes. */
interface SystemMarks {
  avoid: number[]
  notes: Record<number, string>
}

interface BridgeStore {
  text: string
  list: [number, number][]
  capital: number | null
}

interface Selected {
  i: number
  id: number
  name: string
  sec: number
  region: string
}

interface Scene {
  data: GalaxyData
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  points: Float32Array
  highlight: THREE.Points
  kills: THREE.Group
  route: THREE.Group
  bridges: THREE.Group
  dot: THREE.Texture
  flyTo: (i: number) => void
  fitTo: (indices: number[]) => void
  view: (mode: 'top' | 'side' | 'reset') => void
}

/** SDE coordinates → scene: y is up; z is flipped so the top view matches the in-game map. */
const toScene = (p: number[], i: number) => new THREE.Vector3(p[i * 3], p[i * 3 + 1], -p[i * 3 + 2])

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A ring for marks (intel, you, selection), so they don't read as another security colour. */
function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.strokeStyle = '#fff'
  g.lineWidth = 7
  g.beginPath()
  g.arc(32, 32, 24, 0, Math.PI * 2)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Removes and frees everything in a layer group. */
function clearGroup(g: THREE.Group): void {
  for (const o of [...g.children]) {
    g.remove(o)
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    ;(m.material as THREE.Material | undefined)?.dispose()
  }
}

const cssVar = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

export function GalaxyMap({ currentId }: { currentId?: number | null }) {
  const { lang, sde } = useApp()
  const intel = useIntel()
  const galaxy = useAsync(() => window.api.sde.galaxy(), [sde.state])
  const host = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [showGates, setShowGates] = useState(true)
  const gatesRef = useRef<THREE.LineSegments | null>(null)
  const selectRef = useRef<(i: number | null) => void>(() => {})
  const [showKills, setShowKills] = useState(true)
  const [routeFrom, setRouteFrom] = useState<number | null>(null)
  const [routeTo, setRouteTo] = useState<number | null>(null)
  const [flag, setFlag] = useState<Flag>('secure')
  const [bridges, setBridges] = useState<BridgeStore>({ text: '', list: [], capital: null })
  const [showBridges, setShowBridges] = useState(true)
  const [viaBridges, setViaBridges] = useState(true)
  const [bridgesOpen, setBridgesOpen] = useState(false)
  useEffect(() => {
    void window.api.store.get<BridgeStore>(BRIDGES_KEY).then((b) => b && setBridges(b))
  }, [])
  const saveBridges = (b: BridgeStore) => {
    setBridges(b)
    void window.api.store.set(BRIDGES_KEY, b)
  }
  const [marks, setMarks] = useState<SystemMarks>({ avoid: [], notes: {} })
  useEffect(() => {
    void window.api.store.get<SystemMarks>(SYSTEMS_KEY).then((m) => m && setMarks({ avoid: m.avoid ?? [], notes: m.notes ?? {} }))
  }, [])
  const saveMarks = (m: SystemMarks) => {
    setMarks(m)
    void window.api.store.set(SYSTEMS_KEY, m)
  }
  const toggleAvoid = (id: number) =>
    saveMarks({ ...marks, avoid: marks.avoid.includes(id) ? marks.avoid.filter((x) => x !== id) : [...marks.avoid, id] })
  const setNote = (id: number, text: string) => {
    const notes = { ...marks.notes }
    if (text.trim()) notes[id] = text.trim()
    else delete notes[id]
    saveMarks({ ...marks, notes })
  }
  const marksRef = useRef(marks)
  marksRef.current = marks

  // Kills in the last hour (ESI), refreshed while the map is open.
  const kills = useAsync(async () => {
    const rows = await esi<{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }[]>('/universe/system_kills/')
    return new Map<number, Kills>(rows.map((r) => [r.system_id, { ship: r.ship_kills, pod: r.pod_kills, npc: r.npc_kills }]))
  }, [])
  const killsRef = useRef<Map<number, Kills>>(new Map())
  killsRef.current = kills.data ?? new Map()
  const reloadKills = kills.reload
  useEffect(() => {
    const t = setInterval(reloadKills, KILLS_REFRESH_MS)
    return () => clearInterval(t)
  }, [reloadKills])

  const origin = routeFrom ?? currentId ?? null
  // ESI routes over stargates only. With jump bridges the route is worked out locally, and used
  // only when it actually takes a bridge: otherwise ESI's route is exactly the game's.
  const useBridgeRoute = viaBridges && bridges.list.length > 0
  // Avoided systems: ESI refuses the start or the end in the list, so those are left out.
  const avoid = marks.avoid.filter((id) => id !== origin && id !== routeTo)
  const route = useAsync(async (): Promise<{ ids: number[]; bridgeHops: number; local: boolean } | null> => {
    if (!origin || !routeTo || origin === routeTo) return null
    if (useBridgeRoute) {
      const local = await window.api.sde.routeLocal(origin, routeTo, flag, bridges.list, avoid)
      if (local?.bridgeHops) return { ...local, local: true }
    }
    const avoidQuery = avoid.length ? `&avoid=${avoid.join(',')}` : ''
    return { ids: await esi<number[]>(`/route/${origin}/${routeTo}/?flag=${flag}${avoidQuery}`), bridgeHops: 0, local: false }
  }, [origin, routeTo, flag, useBridgeRoute, bridges.list.length && JSON.stringify(bridges.list), avoid.join(',')])

  const data = galaxy.data
  const indexOf = useRef(new Map<number, number>())

  selectRef.current = (i) => {
    if (i === null || !data) return setSelected(null)
    setSelected({ i, id: data.ids[i], name: data.names[i], sec: data.sec[i], region: tn(data.regions[data.region[i]], lang) })
  }

  // ---- Build the scene once the data is in ----
  useEffect(() => {
    const el = host.current
    const labelLayer = labels.current
    if (!data || !el || !labelLayer) return
    indexOf.current = new Map(data.ids.map((id, i) => [id, i]))
    const n = data.ids.length

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(new THREE.Color(cssVar('--bg', '#131416')), 1)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.screenSpacePanning = true
    controls.minDistance = 1.5
    controls.maxDistance = 400

    // Systems
    const positions = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)
    const color = new THREE.Color()
    const centre = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const v = toScene(data.pos, i)
      positions.set([v.x, v.y, v.z], i * 3)
      centre.add(v)
      color.set(secColor(data.sec[i]))
      colors.set([color.r, color.g, color.b], i * 3)
    }
    centre.divideScalar(n)
    const dot = dotTexture()
    const ring = ringTexture()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, map: dot, transparent: true, depthWrite: false })
    )
    scene.add(stars)

    // Stargates: coloured like their systems, faint so the stars stay readable.
    const linePos = new Float32Array(data.edges.length * 3)
    const lineCol = new Float32Array(data.edges.length * 3)
    data.edges.forEach((idx, k) => {
      linePos.set(positions.subarray(idx * 3, idx * 3 + 3), k * 3)
      lineCol.set(colors.subarray(idx * 3, idx * 3 + 3), k * 3)
    })
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3))
    const gates = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false }))
    gatesRef.current = gates
    scene.add(gates)

    // Highlights (intel, current system, selection): bigger dots on top, refreshed from React state.
    const hlGeo = new THREE.BufferGeometry()
    hlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    hlGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
    const highlight = new THREE.Points(
      hlGeo,
      new THREE.PointsMaterial({ size: 22, sizeAttenuation: false, vertexColors: true, map: ring, transparent: true, depthTest: false, depthWrite: false })
    )
    highlight.renderOrder = 2
    // Its bounds change with every update: never cull it.
    highlight.frustumCulled = false
    scene.add(highlight)

    // Layers filled from React state: kills in the last hour (under the stars) and the route.
    const killsGroup = new THREE.Group()
    killsGroup.renderOrder = -1
    scene.add(killsGroup)
    const routeGroup = new THREE.Group()
    routeGroup.renderOrder = 1
    scene.add(routeGroup)
    const bridgesGroup = new THREE.Group()
    scene.add(bridgesGroup)

    // Region labels at the centre of each region's systems.
    const regionSums = new Map<number, { v: THREE.Vector3; n: number }>()
    for (let i = 0; i < n; i++) {
      const r = regionSums.get(data.region[i]) ?? { v: new THREE.Vector3(), n: 0 }
      r.v.add(toScene(data.pos, i))
      r.n++
      regionSums.set(data.region[i], r)
    }
    // Bigger regions first: when labels would overlap, the smaller region's name is hidden.
    const regionLabels = [...regionSums]
      .sort((x, y) => y[1].n - x[1].n)
      .map(([id, { v, n: count }]) => {
        const div = document.createElement('div')
        div.className = 'gx-region'
        div.textContent = tn(data.regions[id], lang)
        labelLayer.appendChild(div)
        return { pos: v.divideScalar(count), div, w: div.offsetWidth, h: div.offsetHeight }
      })
    const systemLabels = Array.from({ length: SYSTEM_LABELS }, () => {
      const div = document.createElement('div')
      div.className = 'gx-system'
      labelLayer.appendChild(div)
      return div
    })

    // Camera: the whole of New Eden, tilted.
    const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute)
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius
    const home = () => {
      controls.target.copy(centre)
      camera.position.copy(centre).add(new THREE.Vector3(0, radius * 0.95, radius * 0.7))
      camera.up.set(0, 1, 0)
    }
    home()

    let flight: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t0: number } | null = null
    const flyTo = (i: number) => {
      const to = new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      const dir = camera.position.clone().sub(controls.target).normalize()
      flight = { from: controls.target.clone(), to, camFrom: camera.position.clone(), camTo: to.clone().add(dir.multiplyScalar(14)), t0: performance.now() }
    }
    /** Frames a set of systems (a route), keeping the current viewing angle. */
    const fitTo = (indices: number[]) => {
      if (!indices.length) return
      const b = new THREE.Box3()
      for (const i of indices) b.expandByPoint(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))
      const c = b.getCenter(new THREE.Vector3())
      const r = Math.max(4, b.getBoundingSphere(new THREE.Sphere()).radius)
      const dir = camera.position.clone().sub(controls.target).normalize()
      flight = { from: controls.target.clone(), to: c, camFrom: camera.position.clone(), camTo: c.clone().add(dir.multiplyScalar(r * 2.6)), t0: performance.now() }
    }
    const view = (mode: 'top' | 'side' | 'reset') => {
      if (mode === 'reset') {
        flight = null
        return home()
      }
      const d = camera.position.distanceTo(controls.target)
      const offset = mode === 'top' ? new THREE.Vector3(0, d, 0.001) : new THREE.Vector3(0, d * 0.05, d)
      flight = { from: controls.target.clone(), to: controls.target.clone(), camFrom: camera.position.clone(), camTo: controls.target.clone().add(offset), t0: performance.now() }
    }

    // ---- Picking: nearest projected star within a few pixels ----
    const v = new THREE.Vector3()
    const pick = (x: number, y: number): number | null => {
      const w = el.clientWidth
      const h = el.clientHeight
      let best = -1
      let bestD = PICK_PX * PICK_PX
      for (let i = 0; i < n; i++) {
        v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).project(camera)
        if (v.z > 1) continue
        const dx = ((v.x + 1) / 2) * w - x
        const dy = ((1 - v.y) / 2) * h - y
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best < 0 ? null : best
    }
    let down: { x: number; y: number } | null = null
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const i = pick(e.clientX - r.left, e.clientY - r.top)
      const t = tip.current
      if (!t) return
      if (i === null || down) {
        t.hidden = true
        el.style.cursor = ''
        return
      }
      t.hidden = false
      t.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 12}px)`
      t.innerHTML = ''
      const b = document.createElement('b')
      b.textContent = data.names[i]
      const s = document.createElement('span')
      s.textContent = ` ${(Math.round(data.sec[i] * 10) / 10).toFixed(1)} · ${tn(data.regions[data.region[i]], lang)}`
      s.style.color = secColor(data.sec[i])
      t.append(b, s)
      const k = pvp(killsRef.current.get(data.ids[i]))
      if (k) {
        const kl = document.createElement('div')
        kl.className = 'bad'
        kl.textContent = translate(`Убийств за час: ${k}`)
        t.append(kl)
      }
      const note = marksRef.current.notes[data.ids[i]]
      if (note) {
        const nl = document.createElement('div')
        nl.className = 'gx-tip-note'
        nl.textContent = `✎ ${note.split('\n')[0].slice(0, 80)}`
        t.append(nl)
      }
      el.style.cursor = 'pointer'
    }
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
        const r = el.getBoundingClientRect()
        selectRef.current(pick(e.clientX - r.left, e.clientY - r.top))
      }
      down = null
    }
    const onLeave = () => tip.current && (tip.current.hidden = true)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    // ---- Size ----
    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = `${w}px`
      renderer.domElement.style.height = `${h}px`
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // ---- Frame loop ----
    /** Screen position of a scene point, or null when it is behind the camera or off screen. */
    const screen = (p: THREE.Vector3, w: number, h: number): [number, number] | null => {
      v.copy(p).project(camera)
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return null
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h]
    }
    const taken: [number, number, number, number][] = []
    const near: { i: number; d: number }[] = []
    const noteMarks: HTMLDivElement[] = []
    const labelPos = new THREE.Vector3()
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (flight) {
        const k = Math.min(1, (performance.now() - flight.t0) / 700)
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
        controls.target.lerpVectors(flight.from, flight.to, e)
        camera.position.lerpVectors(flight.camFrom, flight.camTo, e)
        if (k >= 1) flight = null
      }
      controls.update()
      const w = el.clientWidth
      const h = el.clientHeight
      const dist = camera.position.distanceTo(controls.target)
      // Regions fade out as you zoom in, system names fade in.
      const regionAlpha = Math.max(0, Math.min(1, (dist - 12) / 30))
      taken.length = 0
      for (const r of regionLabels) {
        const at = regionAlpha > 0 ? screen(r.pos, w, h) : null
        const box: [number, number, number, number] | null = at && [at[0] - r.w / 2 - 6, at[1] - r.h / 2 - 2, at[0] + r.w / 2 + 6, at[1] + r.h / 2 + 2]
        const free = box && !taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])
        if (!at || !free) {
          r.div.style.opacity = '0'
          continue
        }
        taken.push(box)
        r.div.style.transform = `translate(${at[0]}px, ${at[1]}px) translate(-50%, -50%)`
        r.div.style.opacity = String(regionAlpha)
      }
      near.length = 0
      if (dist < SYSTEM_LABEL_DIST) {
        const reach = dist * 0.9
        for (let i = 0; i < n; i++) {
          const dx = positions[i * 3] - controls.target.x
          const dy = positions[i * 3 + 1] - controls.target.y
          const dz = positions[i * 3 + 2] - controls.target.z
          const d = dx * dx + dy * dy + dz * dz
          if (d < reach * reach) near.push({ i, d })
        }
        near.sort((a, b) => a.d - b.d)
      }
      const sysAlpha = Math.max(0, Math.min(1, (SYSTEM_LABEL_DIST - dist) / 8))
      // Nearest systems first; a name that would overlap one already shown is skipped.
      let k = 0
      for (const div of systemLabels) {
        let shown = false
        while (!shown && k < near.length) {
          const i = near[k++].i
          const at = screen(labelPos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]), w, h)
          if (!at) continue
          const half = data.names[i].length * 3.4 + 4
          const box: [number, number, number, number] = [at[0] - half, at[1] + 5, at[0] + half, at[1] + 20]
          if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue
          taken.push(box)
          if (div.textContent !== data.names[i]) div.textContent = data.names[i]
          div.style.transform = `translate(${at[0]}px, ${at[1]}px) translate(-50%, -50%)`
          div.style.opacity = String(sysAlpha)
          shown = true
        }
        if (!shown) div.style.opacity = '0'
      }
      // ✎ next to systems with a note.
      const noted = Object.keys(marksRef.current.notes)
      while (noteMarks.length < noted.length) {
        const div = document.createElement('div')
        div.className = 'gx-note'
        div.textContent = '✎'
        labelLayer.appendChild(div)
        noteMarks.push(div)
      }
      noteMarks.forEach((div, k) => {
        const i = k < noted.length ? indexOf.current.get(Number(noted[k])) : undefined
        const at = i === undefined ? null : screen(labelPos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]), w, h)
        if (!at) {
          div.style.opacity = '0'
          return
        }
        div.style.transform = `translate(${at[0] + 7}px, ${at[1] - 16}px)`
        div.style.opacity = '1'
      })
      renderer.render(scene, camera)
    }
    frame()

    sceneRef.current = { data, camera, controls, points: positions, highlight, kills: killsGroup, route: routeGroup, bridges: bridgesGroup, dot, flyTo, fitTo, view }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      geo.dispose()
      lineGeo.dispose()
      hlGeo.dispose()
      clearGroup(killsGroup)
      clearGroup(routeGroup)
      clearGroup(bridgesGroup)
      dot.dispose()
      ring.dispose()
      renderer.domElement.remove()
      labelLayer.replaceChildren()
      sceneRef.current = null
      gatesRef.current = null
    }
  }, [data, lang])

  useEffect(() => {
    if (gatesRef.current) gatesRef.current.visible = showGates
  }, [showGates, data])

  // ---- Jump bridges: gold arcs lifted above the gate lines ----
  const bridgesKey = JSON.stringify(bridges.list)
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    clearGroup(s.bridges)
    if (!showBridges || !bridges.list.length) return
    const pts: number[] = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    for (const [x, y] of bridges.list) {
      const i = indexOf.current.get(x)
      const j = indexOf.current.get(y)
      if (i === undefined || j === undefined) continue
      a.fromArray(s.points, i * 3)
      b.fromArray(s.points, j * 3)
      const mid = a.clone().add(b).multiplyScalar(0.5)
      mid.y += a.distanceTo(b) * 0.25
      const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone())
      const p = curve.getPoints(16)
      for (let k = 0; k < p.length - 1; k++) pts.push(p[k].x, p[k].y, p[k].z, p[k + 1].x, p[k + 1].y, p[k + 1].z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar('--star', '#ffd98a')), transparent: true, opacity: 0.85, depthWrite: false }))
    lines.frustumCulled = false
    s.bridges.add(lines)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgesKey, showBridges, data])

  // ---- Kills in the last hour: a red glow, bigger for busier systems ----
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    clearGroup(s.kills)
    if (!showKills || !kills.data) return
    // Three sizes: a lone kill, a fight, a big fight.
    const buckets: [number, number, number[]][] = [
      [1, 10, []],
      [3, 16, []],
      [10, 26, []]
    ]
    for (const [id, k] of kills.data) {
      const i = indexOf.current.get(id)
      const n = pvp(k)
      if (i === undefined || !n) continue
      const b = [...buckets].reverse().find(([min]) => n >= min)!
      b[2].push(s.points[i * 3], s.points[i * 3 + 1], s.points[i * 3 + 2])
    }
    for (const [, size, pos] of buckets) {
      if (!pos.length) continue
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
      const m = new THREE.PointsMaterial({
        size,
        sizeAttenuation: false,
        color: 0xff4a2e,
        map: s.dot,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
      const pts = new THREE.Points(g, m)
      pts.frustumCulled = false
      s.kills.add(pts)
    }
  }, [kills.data, showKills, data])

  // ---- Route: a bright line through the systems, with a dot on each ----
  const routeIds = route.data?.ids ?? null
  const routeKey = routeIds?.join(',') ?? ''
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    clearGroup(s.route)
    if (!routeIds) return
    const pos: number[] = []
    const onRoute: number[] = []
    for (const id of routeIds) {
      const i = indexOf.current.get(id)
      if (i === undefined) continue
      onRoute.push(i)
      pos.push(s.points[i * 3], s.points[i * 3 + 1], s.points[i * 3 + 2])
    }
    s.fitTo(onRoute)
    const accent = new THREE.Color(cssVar('--accent', '#3dbf9c'))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    // White line, accent dots: the line mustn't read as one more highsec colour.
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }))
    const dots = new THREE.Points(
      g.clone(),
      new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, color: accent, map: s.dot, transparent: true, depthTest: false, depthWrite: false })
    )
    for (const o of [line, dots]) {
      o.frustumCulled = false
      o.renderOrder = 1
      s.route.add(o)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, data])

  // ---- Highlights: fresh intel reports, current system, selection ----
  const now = Date.now()
  const hostile = new Set<number>()
  for (const r of intel.reports) if (!r.clear && now - new Date(r.at).getTime() < REPORT_FRESH_MS) r.systems.forEach((id) => hostile.add(id))
  const hostileKey = [...hostile].sort().join(',')
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    const marks: { i: number; c: string }[] = []
    const add = (id: number | null | undefined, c: string) => {
      const i = id ? indexOf.current.get(id) : undefined
      if (i !== undefined) marks.push({ i, c })
    }
    hostile.forEach((id) => add(id, cssVar('--bad', '#f07a66')))
    add(currentId, cssVar('--accent', '#3dbf9c'))
    marksRef.current.avoid.forEach((id) => add(id, cssVar('--muted', '#9d9e99')))
    if (selected) add(selected.id, '#ffffff')
    const pos = new Float32Array(marks.length * 3)
    const col = new Float32Array(marks.length * 3)
    const c = new THREE.Color()
    marks.forEach((m, k) => {
      pos.set(s.points.subarray(m.i * 3, m.i * 3 + 3), k * 3)
      c.set(m.c)
      col.set([c.r, c.g, c.b], k * 3)
    })
    s.highlight.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    s.highlight.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostileKey, currentId, selected?.id, data, marks.avoid.join(',')])

  const fly = (id: number | null | undefined) => {
    const i = id ? indexOf.current.get(id) : undefined
    if (i === undefined) return
    sceneRef.current?.flyTo(i)
    selectRef.current(i)
  }

  if (sde.state !== 'ready' && !data) return <Loading label="Загружаю данные SDE…" />
  if (galaxy.error) return <ErrorBox error={galaxy.error} />

  return (
    <div className="galaxy">
      <div className="gx-toolbar">
        <div className="gx-search">
          <SearchBox placeholder="Найти систему…" search={searchSystemsSde} onSelect={(s) => fly(s.id)} clearOnSelect />
        </div>
        {currentId && (
          <button className="ghost" onClick={() => fly(currentId)}>
            Где я
          </button>
        )}
        <button className="ghost" onClick={() => sceneRef.current?.view('top')}>
          Сверху
        </button>
        <button className="ghost" onClick={() => sceneRef.current?.view('side')}>
          Сбоку
        </button>
        <button className="ghost" onClick={() => sceneRef.current?.view('reset')}>
          Вся карта
        </button>
        <label className="check">
          <input type="checkbox" checked={showGates} onChange={(e) => setShowGates(e.target.checked)} />
          Звёздные врата
        </label>
        <button className={bridgesOpen ? '' : 'ghost'} onClick={() => setBridgesOpen((o) => !o)}>
          {bridges.list.length ? `Мосты: ${bridges.list.length}` : 'Мосты'}
        </button>
        {bridges.list.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={showBridges} onChange={(e) => setShowBridges(e.target.checked)} />
            Показывать мосты
          </label>
        )}
        <label className="check" title={kills.error ?? undefined}>
          <input type="checkbox" checked={showKills} onChange={(e) => setShowKills(e.target.checked)} />
          Убийства за час
        </label>
      </div>
      <div className="gx-stage">
        <div ref={host} className="gx-canvas" />
        <div ref={labels} className="gx-labels" />
        <div ref={tip} className="gx-tip" hidden />
        {!data && <Loading label="Строю карту…" />}
        <div className="gx-legend">
          <span>
            <i style={{ background: secColor(1) }} /> хайсек
          </span>
          <span>
            <i style={{ background: secColor(0.3) }} /> лоусек
          </span>
          <span>
            <i style={{ background: secColor(-0.5) }} /> нули
          </span>
          {showKills && (
            <span>
              <i className="gx-glow" /> убийства за час
            </span>
          )}
          {showBridges && bridges.list.length > 0 && (
            <span>
              <i className="gx-bridge" /> мосты
            </span>
          )}
          <span>
            <i className="gx-mark" style={{ '--mark': 'var(--bad)' } as CSSProperties} /> разведка, 15 мин
          </span>
          {currentId && (
            <span>
              <i className="gx-mark" style={{ '--mark': 'var(--accent)' } as CSSProperties} /> вы здесь
            </span>
          )}
          {marks.avoid.length > 0 && (
            <span>
              <i className="gx-mark" style={{ '--mark': 'var(--muted)' } as CSSProperties} /> избегать
            </span>
          )}
          {Object.keys(marks.notes).length > 0 && <span>✎ заметка</span>}
        </div>
        {selected && (
          <div className="gx-card">
            <div className="gx-card-head">
              <b>{selected.name}</b> <Sec value={selected.sec} />
              <button className="ghost gx-close" onClick={() => setSelected(null)} aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="muted">{selected.region}</div>
            {pvp(kills.data?.get(selected.id)) > 0 && (
              <div className="bad small">{`Убийств за час: ${pvp(kills.data?.get(selected.id))}`}</div>
            )}
            {hostile.has(selected.id) && <div className="bad small">В интел-каналах за последние 15 минут</div>}
            <div className="gx-card-actions">
              <button
                className="ghost small"
                disabled={!origin || origin === selected.id}
                title={!origin ? 'Сначала выберите начало маршрута: «Отсюда»' : undefined}
                onClick={() => setRouteTo(selected.id)}
              >
                Маршрут сюда
              </button>
              <button className="ghost small" onClick={() => setRouteFrom(selected.id)}>
                Отсюда
              </button>
              <button className={marks.avoid.includes(selected.id) ? 'small' : 'ghost small'} onClick={() => toggleAvoid(selected.id)} title="Маршруты будут обходить эту систему">
                {marks.avoid.includes(selected.id) ? 'Избегается' : 'Избегать'}
              </button>
            </div>
            <NoteField key={selected.id} value={marks.notes[selected.id] ?? ''} onSave={(t) => setNote(selected.id, t)} />
          </div>
        )}
        {routeTo && (
          <RoutePanel
            data={data}
            indexOf={indexOf.current}
            ids={routeIds}
            bridgeHops={route.data?.bridgeHops ?? 0}
            hasBridges={bridges.list.length > 0}
            avoided={avoid.length}
            onClearAvoid={() => saveMarks({ ...marks, avoid: [] })}
            viaBridges={viaBridges}
            setViaBridges={setViaBridges}
            loading={route.loading}
            error={route.error}
            from={origin}
            to={routeTo}
            flag={flag}
            setFlag={setFlag}
            kills={kills.data}
            onSystem={fly}
            onClear={() => {
              setRouteTo(null)
              setRouteFrom(null)
            }}
          />
        )}
      </div>
      {bridgesOpen && data && <BridgesCard data={data} indexOf={indexOf.current} value={bridges} onSave={saveBridges} onSystem={fly} />}
      <p className="muted small">Вращение — левая кнопка мыши, сдвиг — правая, масштаб — колесо. Координаты систем — из SDE, как в игровом клиенте.</p>
    </div>
  )
}

function RoutePanel({
  data,
  indexOf,
  ids,
  bridgeHops,
  hasBridges,
  avoided,
  onClearAvoid,
  viaBridges,
  setViaBridges,
  loading,
  error,
  from,
  to,
  flag,
  setFlag,
  kills,
  onSystem,
  onClear
}: {
  data: GalaxyData | undefined
  indexOf: Map<number, number>
  ids: number[] | null
  bridgeHops: number
  hasBridges: boolean
  avoided: number
  onClearAvoid: () => void
  viaBridges: boolean
  setViaBridges: (v: boolean) => void
  loading: boolean
  error: string | null
  from: number | null
  to: number
  flag: Flag
  setFlag: (f: Flag) => void
  kills: Map<number, Kills> | undefined
  onSystem: (id: number) => void
  onClear: () => void
}) {
  const name = (id: number | null) => (id && data ? data.names[indexOf.get(id) ?? -1] ?? String(id) : '—')
  const sec = (id: number) => (data ? data.sec[indexOf.get(id) ?? -1] ?? 0 : 0)
  const list = ids ?? []
  const count = { high: 0, low: 0, null: 0 }
  for (const id of list.slice(1)) {
    const r = Math.round(sec(id) * 10) / 10
    if (r >= 0.5) count.high++
    else if (r > 0) count.low++
    else count.null++
  }
  const hot = list.map((id) => ({ id, n: pvp(kills?.get(id)) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  return (
    <div className="gx-route">
      <div className="gx-card-head">
        <b>
          {name(from)} → {name(to)}
        </b>
        <button className="ghost gx-close" onClick={onClear} aria-label="Закрыть">
          ×
        </button>
      </div>
      <select value={flag} onChange={(e) => setFlag(e.target.value as Flag)}>
        <option value="secure">Безопасный</option>
        <option value="shortest">Кратчайший</option>
        <option value="insecure">Через low/null</option>
      </select>
      {avoided > 0 && (
        <div className="small">
          <span className="muted">{`Обходит систем: ${avoided}`}</span>{' '}
          <button className="gx-link" onClick={onClearAvoid}>
            сбросить
          </button>
        </div>
      )}
      {hasBridges && (
        <label className="check small">
          <input type="checkbox" checked={viaBridges} onChange={(e) => setViaBridges(e.target.checked)} />
          Через мосты альянса
        </label>
      )}
      {loading && !ids ? (
        <div className="muted">Прокладываю…</div>
      ) : error ? (
        <div className="bad small">{error}</div>
      ) : ids ? (
        <>
          <div>
            <b>{`${list.length - 1} прыжков`}</b>
            <span className="muted">
              {' · '}
              <span style={{ color: secColor(1) }}>{count.high}</span> / <span style={{ color: secColor(0.3) }}>{count.low}</span> /{' '}
              <span style={{ color: secColor(-0.5) }}>{count.null}</span>
            </span>
          </div>
          {bridgeHops > 0 && (
            <div className="small">
              <span style={{ color: 'var(--star)' }}>{`По мостам: ${bridgeHops}`}</span>
              <span className="muted"> · только для субкапиталов</span>
              {flag !== 'shortest' && <div className="muted">Маршрут с мостами считает Canopus: безопасный вариант может отличаться от игрового на пару прыжков.</div>}
            </div>
          )}
          {hot.length > 0 ? (
            <div className="small">
              <span className="bad">{`Убийства за час на маршруте: ${hot.reduce((a, x) => a + x.n, 0)}`}</span>
              <ul className="gx-hot">
                {hot.slice(0, 5).map((x) => (
                  <li key={x.id}>
                    <button className="gx-link" onClick={() => onSystem(x.id)}>
                      {name(x.id)}
                    </button>{' '}
                    <span className="muted">{x.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="muted small">На маршруте не было убийств за последний час</div>
          )}
          <GameButton scope={SCOPE.waypoint} className="ghost small" action={(who) => setDestinationInGame(who, to)} title="Установить пункт назначения в клиенте игры">
            Проложить в игре
          </GameButton>
        </>
      ) : null}
    </div>
  )
}

/** Paste the alliance's jump bridges, pick the capital: distances show how far each bridge reaches. */
function BridgesCard({
  data,
  indexOf,
  value,
  onSave,
  onSystem
}: {
  data: GalaxyData
  indexOf: Map<number, number>
  value: BridgeStore
  onSave: (b: BridgeStore) => void
  onSystem: (id: number) => void
}) {
  const [text, setText] = useState(value.text)
  const [unknown, setUnknown] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => setText(value.text), [value.text])
  const name = (id: number) => data.names[indexOf.get(id) ?? -1] ?? String(id)
  const ly = (x: number, y: number): number | null => {
    const i = indexOf.get(x)
    const j = indexOf.get(y)
    if (i === undefined || j === undefined) return null
    const p = data.pos
    return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2])
  }
  async function save() {
    setBusy(true)
    try {
      const r = await window.api.sde.parseBridges(text)
      setUnknown(r.unknown)
      onSave({ ...value, text, list: r.bridges })
    } finally {
      setBusy(false)
    }
  }
  // Cost grows with the distance from the capital to the bridge's far end.
  const rows = value.list
    .map(([a, b]) => {
      const far = value.capital ? Math.max(ly(value.capital, a) ?? 0, ly(value.capital, b) ?? 0) : null
      return { a, b, len: ly(a, b), far }
    })
    .sort((x, y) => (x.far ?? 0) - (y.far ?? 0))
  return (
    <Card title="Мосты альянса (Ansiblex)" className="gx-bridges">
      <p className="muted small">
        Вставьте список мостов, по одному на строку: «1DQ1-A » 8WA-Z6», формат Dotlan («1DQ1-A @ 3-4 » 8WA-Z6 @ 1-1») или названия структур. После Cradle of War
        мосты доступны только субкапиталам, а цена прыжка растёт с расстоянием от столицы альянса.
      </p>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="1DQ1-A » 8WA-Z6" spellCheck={false} />
      <div className="row">
        <button disabled={busy} onClick={() => void save()}>
          Сохранить
        </button>
        <span className="muted small">{`Найдено мостов: ${value.list.length}`}</span>
      </div>
      {unknown.length > 0 && (
        <div className="small">
          <span className="bad">{`Не распознано строк: ${unknown.length}`}</span>
          <ul className="gx-hot">
            {unknown.slice(0, 5).map((l, k) => (
              <li key={k} className="muted" translate="no">
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="row">
        <span>Столица альянса:</span>
        {value.capital ? (
          <>
            <button className="gx-link" onClick={() => onSystem(value.capital!)}>
              {name(value.capital)}
            </button>
            <button className="ghost small" onClick={() => onSave({ ...value, capital: null })}>
              ×
            </button>
          </>
        ) : (
          <div className="gx-search">
            <SearchBox placeholder="Найти систему…" search={searchSystemsSde} onSelect={(s) => onSave({ ...value, capital: s.id })} clearOnSelect />
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="gx-bridge-table">
          <table className="table">
            <thead>
              <tr>
                <th>Мост</th>
                <th className="num">Длина, ly</th>
                {value.capital && <th className="num">От столицы, ly</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.a}-${r.b}`}>
                  <td>
                    <button className="gx-link" onClick={() => onSystem(r.a)}>
                      {name(r.a)}
                    </button>
                    {' ⇄ '}
                    <button className="gx-link" onClick={() => onSystem(r.b)}>
                      {name(r.b)}
                    </button>
                  </td>
                  <td className="num">{r.len?.toFixed(1) ?? '—'}</td>
                  {value.capital && <td className="num">{r.far?.toFixed(1) ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/** A note on a system, saved when the field loses focus. */
function NoteField({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(value)
  return (
    <textarea
      className="gx-note-field"
      rows={text ? 3 : 1}
      value={text}
      placeholder="Заметка: станции, кто живёт, ссылки…"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onSave(text)}
    />
  )
}
