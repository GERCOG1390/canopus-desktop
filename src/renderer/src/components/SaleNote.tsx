// A short note under a sale value when it isn't the plain sell order: priced by what the item really traded at,
// not selling at all, or selling slowly (shared/saleValue.ts).

import type { ReactNode } from 'react'
import type { Price } from '../lib/market'
import { fmtIsk, fmtNum } from '../lib/format'
import { translate } from '../i18n'

export function SaleNote({ p, fallback }: { p?: Price; fallback?: ReactNode }) {
  const s = p?.sale
  if (!s || !p) return <>{fallback}</>
  if (s.checked && s.unit === 0) return <span className="bad">{translate('не продавался 90 дней')}</span>
  const parts: string[] = []
  if (s.unit < p.sell.best) parts.push(`${translate('по сделкам, ордер')} ${fmtIsk(p.sell.best, true)}`)
  if (s.perDay !== undefined && s.perDay < 1) parts.push(translate('продаётся реже раза в день'))
  else if (s.perDay !== undefined) parts.push(`${translate('продаётся в день:')} ${fmtNum(Math.round(s.perDay))}`)
  if (!s.checked) parts.push(translate('история торгов не проверена'))
  if (!parts.length) return <>{fallback}</>
  return <span className={s.perDay !== undefined && s.perDay < 1 ? 'warn' : 'muted'}>{parts.join(' · ')}</span>
}
