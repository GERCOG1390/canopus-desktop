import { useEffect, useRef, useState, type ReactNode } from 'react'
import { imageUrl } from '../lib/esi'
import { roundSec, secColor } from '../lib/format'

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h3>{title}</h3>
          <div className="card-actions">{actions}</div>
        </header>
      )}
      {children}
    </section>
  )
}

export const Loading = ({ label = 'Загрузка…' }: { label?: string }) => <div className="muted loading">{label}</div>

export const ErrorBox = ({ error }: { error: string | null | undefined }) => (error ? <div className="error">{error}</div> : null)

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={t.id === value ? 'tab active' : 'tab'} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export const TypeIcon = ({ typeId, size = 32 }: { typeId: number; size?: number }) => (
  <img className="type-icon" src={imageUrl.typeIcon(typeId, size > 32 ? 64 : 32)} width={size} height={size} alt="" loading="lazy" />
)

export const Sec = ({ value }: { value: number }) => (
  <span className="sec" style={{ color: secColor(value) }}>
    {roundSec(value).toFixed(1)}
  </span>
)

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>

/** Text input with an async suggestion dropdown. */
export function SearchBox<T extends { id: number; name: string }>({
  placeholder,
  search,
  onSelect,
  initial = '',
  renderItem,
  clearOnSelect = false
}: {
  placeholder: string
  search: (q: string) => Promise<T[]>
  onSelect: (item: T) => void
  initial?: string
  renderItem?: (item: T) => ReactNode
  clearOnSelect?: boolean
}) {
  const [query, setQuery] = useState(initial)
  const [items, setItems] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const seq = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => setQuery(initial), [initial])
  useEffect(() => () => clearTimeout(debounce.current), [])

  async function run(q: string, autoPick: boolean) {
    const id = ++seq.current
    setBusy(true)
    setHint('')
    try {
      const res = await search(q)
      if (id !== seq.current) return
      if (autoPick && res.length === 1) {
        pick(res[0])
        return
      }
      setItems(res)
      setOpen(true)
      if (!res.length) setHint('Ничего не найдено')
    } catch (e) {
      if (id === seq.current) setHint((e as Error).message)
    } finally {
      if (id === seq.current) setBusy(false)
    }
  }

  function pick(item: T) {
    setQuery(clearOnSelect ? '' : item.name)
    setOpen(false)
    setItems([])
    onSelect(item)
  }

  return (
    <div className="searchbox">
      <input
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          const q = e.target.value
          setQuery(q)
          setOpen(true)
          clearTimeout(debounce.current)
          if (q.trim().length >= 2) debounce.current = setTimeout(() => void run(q, false), 250)
          else {
            seq.current++
            setItems([])
            setHint('')
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            clearTimeout(debounce.current)
            void run(query, true)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => items.length && setOpen(true)}
      />
      {busy && <span className="searchbox-spinner">…</span>}
      {open && (items.length > 0 || hint) && (
        <ul className="suggestions">
          {items.map((it) => (
            <li key={it.id} onMouseDown={() => pick(it)}>
              {renderItem ? renderItem(it) : it.name}
            </li>
          ))}
          {!items.length && hint && <li className="muted">{hint}</li>}
        </ul>
      )}
    </div>
  )
}

export function RequireLogin({ children, what }: { children?: ReactNode; what: string }) {
  return (
    <Empty>
      Войдите через EVE SSO в разделе «Настройки», чтобы видеть {what}.
      {children}
    </Empty>
  )
}

/** Tiny dependency-free line chart. */
export function Sparkline({ values, width = 260, height = 56 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 4 - ((v - min) / span) * (height - 8)}`)
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={pts.join(' ')} fill="none" strokeWidth="2" />
    </svg>
  )
}
