// 3D map of known space from the SDE's real coordinates: systems coloured by security, stargate
// links, region and system labels, fresh intel reports and your current system. three.js / WebGL;
// labels are HTML placed over the canvas every frame.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GalaxyData } from '../../../shared/sde'
import { REPORT_FRESH_MS, useIntel } from '../IntelContext'
import { useApp } from '../AppContext'
import { ErrorBox, Loading, SearchBox, Sec } from './ui'
import { searchSystemsSde, tn } from '../lib/sde'
import { secColor } from '../lib/format'
import { useAsync } from '../lib/useAsync'

/** How many system names to show when zoomed in, nearest to the centre of the view first. */
const SYSTEM_LABELS = 40
/** Camera distance (ly) below which system names appear. */
const SYSTEM_LABEL_DIST = 28
const PICK_PX = 10

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
  flyTo: (i: number) => void
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
      renderer.render(scene, camera)
    }
    frame()

    sceneRef.current = { data, camera, controls, points: positions, highlight, flyTo, view }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      geo.dispose()
      lineGeo.dispose()
      hlGeo.dispose()
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
  }, [hostileKey, currentId, selected?.id, data])

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
          <span>
            <i className="gx-mark" style={{ '--mark': 'var(--bad)' } as CSSProperties} /> разведка, 15 мин
          </span>
          {currentId && (
            <span>
              <i className="gx-mark" style={{ '--mark': 'var(--accent)' } as CSSProperties} /> вы здесь
            </span>
          )}
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
            {hostile.has(selected.id) && <div className="bad small">В интел-каналах за последние 15 минут</div>}
          </div>
        )}
      </div>
      <p className="muted small">Вращение — левая кнопка мыши, сдвиг — правая, масштаб — колесо. Координаты систем — из SDE, как в игровом клиенте.</p>
    </div>
  )
}
