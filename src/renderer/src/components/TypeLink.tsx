import { Fragment, type ReactNode } from 'react'
import { useLang } from '../AppContext'
import { imageUrl } from '../lib/esi'
import { CATEGORY, tn, useTypeBasic } from '../lib/sde'
import { useInfo } from './InfoContext'

export function typeImage(typeId: number, categoryId: number | undefined, size: number): string {
  const px = size > 32 ? 64 : 32
  if (categoryId === CATEGORY.BLUEPRINT) return `https://images.evetech.net/types/${typeId}/bp?size=${px}`
  return imageUrl.typeIcon(typeId, px)
}

/** Clickable item name with icon; opens the Show Info panel. */
export function TypeLink({
  id,
  icon = true,
  size = 20,
  fallback,
  suffix,
  className = ''
}: {
  id: number
  icon?: boolean
  size?: number
  fallback?: string
  suffix?: ReactNode
  className?: string
}) {
  const lang = useLang()
  const basic = useTypeBasic(id)
  const { open } = useInfo()
  const name = basic ? tn(basic.n, lang) : fallback ?? `#${id}`
  return (
    <span
      className={`type-link ${className}`}
      role="button"
      tabIndex={0}
      title={basic && lang === 1 && basic.n[1] !== basic.n[0] ? basic.n[0] : undefined}
      onClick={(e) => {
        e.stopPropagation()
        open(id)
      }}
      onKeyDown={(e) => e.key === 'Enter' && open(id)}
    >
      {icon && <img className="type-icon" src={typeImage(id, basic?.c, size)} width={size} height={size} alt="" loading="lazy" />}
      <span className="type-name">{name}</span>
      {suffix}
    </span>
  )
}

/** Name only (no click), for places like <option> or titles. */
export function TypeName({ id, fallback }: { id: number; fallback?: string }) {
  const lang = useLang()
  const basic = useTypeBasic(id)
  return <>{basic ? tn(basic.n, lang) : fallback ?? `#${id}`}</>
}

/**
 * Renders EVE's rich text (descriptions, trait bonuses): <a href=showinfo:ID>, <b>, <i>, <br>,
 * <url=...>, colour/font tags. Unknown tags are dropped; nothing is injected as raw HTML.
 */
export function RichText({ text }: { text: string }) {
  const { open } = useInfo()
  const nodes: ReactNode[] = []
  type Frame = { tag: string; attr: string; children: ReactNode[] }
  const stack: Frame[] = [{ tag: 'root', attr: '', children: nodes }]
  const top = () => stack[stack.length - 1]
  const tokenRe = /<\s*(\/?)\s*([a-zA-Z]+)([^>]*)>|\r?\n/g
  let last = 0
  let key = 0

  const pushText = (s: string) => {
    if (s) top().children.push(s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"'))
  }
  const close = (frame: Frame) => {
    const k = key++
    const kids = frame.children
    const parent = top().children
    const link = /showinfo:(\d+)/.exec(frame.attr)
    const url = /(https?:\/\/[^\s"'>]+)/.exec(frame.attr)
    if (frame.tag === 'a' && link) {
      const id = Number(link[1])
      parent.push(
        <span key={k} className="type-link inline" role="button" tabIndex={0} onClick={() => open(id)}>
          {kids}
        </span>
      )
    } else if ((frame.tag === 'a' || frame.tag === 'url') && url) {
      parent.push(
        <a key={k} href={url[1]} target="_blank" rel="noreferrer">
          {kids}
        </a>
      )
    } else if (frame.tag === 'b' || frame.tag === 'strong') parent.push(<b key={k}>{kids}</b>)
    else if (frame.tag === 'i' || frame.tag === 'em') parent.push(<i key={k}>{kids}</i>)
    else if (frame.tag === 'u') parent.push(<u key={k}>{kids}</u>)
    else parent.push(<Fragment key={k}>{kids}</Fragment>)
  }

  for (const m of text.matchAll(tokenRe)) {
    pushText(text.slice(last, m.index))
    last = m.index! + m[0].length
    if (!m[2]) {
      top().children.push(<br key={key++} />)
      continue
    }
    const tag = m[2].toLowerCase()
    if (tag === 'br') {
      top().children.push(<br key={key++} />)
    } else if (m[1]) {
      const idx = stack.map((f) => f.tag).lastIndexOf(tag)
      if (idx > 0) while (stack.length > idx) close(stack.pop()!)
    } else if (['a', 'b', 'strong', 'i', 'em', 'u', 'font', 'color', 'url', 'span'].includes(tag)) {
      stack.push({ tag, attr: m[3], children: [] })
    }
  }
  pushText(text.slice(last))
  while (stack.length > 1) close(stack.pop()!)
  return <>{nodes}</>
}
