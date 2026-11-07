// Income and expense by day: bars up and down from a zero line, hover for the day's numbers. Colors checked
// with the dataviz validator against the card surface; direction also tells the two apart.

import { useState } from 'react'
import { fmtIsk } from '../lib/format'
import { flowLimit } from '../../../shared/uiFormat'
import type { DayFlow } from '../../../shared/walletStats'

const INCOME = '#2fa98a'
const EXPENSE = '#e0614b'
const W = 1000
const H = 220
const PAD = { top: 14, bottom: 24, left: 74, right: 8 }

const shortDay = (day: string): string => day.slice(8) + '.' + day.slice(5, 7)

export function FlowChart({ days }: { days: DayFlow[] }) {
  const [hover, setHover] = useState<number | null>(null)
  // One side's huge day is cut at the limit, its value written next to it; hover still gives the exact numbers.
  const limit = flowLimit(days.flatMap((d) => [d.income, -d.expense]))
  const top = Math.max(1, Math.min(limit, Math.max(...days.map((d) => d.income))))
  const bottom = Math.max(0, Math.min(limit, Math.max(...days.map((d) => -d.expense))))
  const cut = days.some((d) => d.income > top || -d.expense > bottom)
  const plotH = H - PAD.top - PAD.bottom
  const scale = plotH / (top + bottom)
  const zero = PAD.top + top * scale
  const step = (W - PAD.left - PAD.right) / days.length
  const bar = Math.max(2, Math.min(step - 2, 22))
  const h = hover === null ? null : days[hover]
  return (
    <div style={{ position: 'relative' }}>
      <div className="row muted small" style={{ gap: 14, marginBottom: 4 }}>
        <span>
          <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: INCOME, marginRight: 6 }} />
          Доход
        </span>
        <span>
          <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: EXPENSE, marginRight: 6 }} />
          Расход
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Доход и расход по дням" onMouseLeave={() => setHover(null)}>
        <text x={PAD.left - 8} y={PAD.top + 8} textAnchor="end" fill="var(--muted)" fontSize="13">
          {fmtIsk(top, true).replace(' ISK', '')}
        </text>
        {bottom > 0 && (
          <text x={PAD.left - 8} y={H - PAD.bottom} textAnchor="end" fill="var(--muted)" fontSize="13">
            {`−${fmtIsk(bottom, true).replace(' ISK', '')}`}
          </text>
        )}
        <line x1={PAD.left} x2={W - PAD.right} y1={zero} y2={zero} stroke="var(--line-strong)" />
        {days.map((d, i) => {
          const x = PAD.left + i * step + (step - bar) / 2
          const up = Math.min(d.income, top) * scale
          const down = Math.min(-d.expense, bottom) * scale
          const cutUp = d.income > top
          const cutDown = -d.expense > bottom
          const labelLeft = i > days.length / 2
          const lx = labelLeft ? x - 5 : x + bar + 5
          return (
            <g key={d.day}>
              {hover === i && <rect x={PAD.left + i * step} y={PAD.top} width={step} height={plotH} fill="var(--hover)" opacity="0.5" />}
              {up > 0 && <rect x={x} y={zero - up - 1} width={bar} height={Math.max(1, up)} rx={Math.min(3, up / 2)} fill={INCOME} />}
              {down > 0 && <rect x={x} y={zero + 1} width={bar} height={Math.max(1, down)} rx={Math.min(3, down / 2)} fill={EXPENSE} />}
              {cutUp && (
                <>
                  <path d={`M${x - 1} ${PAD.top + 12} l${(bar + 2) / 2} -5 l${(bar + 2) / 2} 5`} fill="none" stroke="var(--card)" strokeWidth="3" />
                  <text x={lx} y={PAD.top + 11} textAnchor={labelLeft ? 'end' : 'start'} fill="var(--text-2)" fontSize="13">
                    {fmtIsk(d.income, true).replace(' ISK', '')}
                  </text>
                </>
              )}
              {cutDown && (
                <>
                  <path d={`M${x - 1} ${H - PAD.bottom - 12} l${(bar + 2) / 2} 5 l${(bar + 2) / 2} -5`} fill="none" stroke="var(--card)" strokeWidth="3" />
                  <text x={lx} y={H - PAD.bottom - 4} textAnchor={labelLeft ? 'end' : 'start'} fill="var(--text-2)" fontSize="13">
                    {`−${fmtIsk(-d.expense, true).replace(' ISK', '')}`}
                  </text>
                </>
              )}
              {i % Math.ceil(days.length / 10) === 0 && (
                <text x={PAD.left + i * step + step / 2} y={H - 6} textAnchor="middle" fill="var(--muted)" fontSize="13">
                  {shortDay(d.day)}
                </text>
              )}
              <rect x={PAD.left + i * step} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          )
        })}
      </svg>
      {cut && <p className="muted small flow-note">Столбец с разрывом не помещается в шкалу: его значение подписано рядом.</p>}
      {h && hover !== null && (
        <div
          style={{
            position: 'absolute',
            top: 26,
            left: `${((PAD.left + hover * step) / W) * 100}%`,
            transform: hover > days.length / 2 ? 'translateX(-100%)' : 'translateX(24px)',
            background: 'var(--panel)',
            border: '1px solid var(--line-strong)',
            borderRadius: 6,
            padding: '6px 10px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 2
          }}
          className="small"
        >
          <b>{h.day}</b>
          <div>{`Доход: ${fmtIsk(h.income, true)}`}</div>
          <div>{`Расход: ${fmtIsk(h.expense, true)}`}</div>
          <div>{`Итого: ${fmtIsk(h.net, true)}`}</div>
        </div>
      )}
    </div>
  )
}
