// The assistant's knowledge base: EVE University wiki articles (CC BY-SA 4.0), CCP news and patch notes,
// and Canopus' own notes on game mechanics, split into short passages and searched locally (BM25).
// Downloaded to this computer and refreshed weekly; nothing of it ships with the app except the notes.

import { app, type WebContents } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KnowledgeHit, KnowledgeStatus } from '../shared/assistant'
import { NOTES } from './knowledgeNotes'

const FORMAT = 1
const UA = 'Canopus (EVE Online companion; https://github.com/GERCOG1390/canopus-desktop)'
const WIKI = 'https://wiki.eveuniversity.org'
const WEEK = 7 * 86400_000

interface Chunk {
  src: 'uni' | 'ccp' | 'notes'
  title: string
  section?: string
  url: string
  date?: string
  text: string
}

interface Store {
  format: number
  updated: { uni?: string; ccp?: string }
  chunks: Chunk[]
}

const storePath = (): string => join(app.getPath('userData'), 'knowledge.json')

let store: Store | null = null
let index: Index | null = null
let updating: Promise<void> | null = null
let progress: KnowledgeStatus['progress']

function load(): Store {
  if (store) return store
  try {
    const s = JSON.parse(readFileSync(storePath(), 'utf8')) as Store
    if (s.format === FORMAT) store = s
  } catch {
    // Not downloaded yet.
  }
  store ??= { format: FORMAT, updated: {}, chunks: [] }
  return store
}

function save(s: Store): void {
  // Written next to the old file and renamed, so a crash never leaves half a base.
  const tmp = storePath() + '.tmp'
  writeFileSync(tmp, JSON.stringify(s))
  renameSync(tmp, storePath())
}

export function status(): KnowledgeStatus {
  const s = load()
  const count = (src: Chunk['src']) => new Set(s.chunks.filter((c) => c.src === src).map((c) => c.title)).size
  return { articles: { uni: count('uni'), ccp: count('ccp'), notes: NOTES.length }, updated: s.updated, updating: !!updating, progress }
}

// ---------- Text clean-up and splitting ----------

/** MediaWiki markup to plain text: templates, files, refs and tables reduced to their readable parts. */
function wikiText(src: string): string {
  let t = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '')
  // Templates nest: remove innermost first until none are left.
  for (let i = 0; i < 6 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, '')
  t = t
    .replace(/\[\[(?:File|Image|Category):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+ ([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/__[A-Z]+__/g, '')
    // Cell styling ("style=... |") before the cell text.
    .replace(/(?:^|(?<=\|\||!!|^[|!]))\s*(?:(?:style|class|align|valign|width|height|colspan|rowspan|scope|bgcolor|data-sort-value)\s*=\s*(?:"[^"]*"|'[^']*'|\S+)\s*)+\|(?!\|)/gm, '')
    // Tables: one line per row, cells separated by " | ".
    .replace(/^\{\|.*$/gm, '')
    .replace(/^\|\}.*$/gm, '')
    .replace(/^\|-.*$/gm, '\n')
    .replace(/^\|\+(.*)$/gm, '$1')
    .replace(/^[|!]\s*/gm, '')
    .replace(/\s*(\|\||!!)\s*/g, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const decodeHtml = (s: string): string =>
  s
    .replace(/<\/(p|li|h\d|tr|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h(\d)[^>]*>/gi, (_m, n: string) => `\n${'='.repeat(Math.min(4, Number(n)))} `)
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const MAX = 1100

/** Sections (by "== Heading ==" lines) cut into passages of up to ~1100 characters on paragraph breaks. */
function split(text: string, base: Omit<Chunk, 'text' | 'section'>, anchor: (section: string) => string): Chunk[] {
  const out: Chunk[] = []
  let section = ''
  let buf = ''
  const flush = () => {
    const t = buf.trim()
    if (t.length >= 60) out.push({ ...base, section: section || undefined, url: section ? anchor(section) : base.url, text: t })
    buf = ''
  }
  for (const para of text.split(/\n\s*\n|\n(?==+ )/)) {
    const h = /^(=+)\s*(.+?)\s*=*\s*$/m.exec(para.trim())
    if (h && para.trim().startsWith('=')) {
      flush()
      section = h[2]
      const rest = para.trim().split('\n').slice(1).join('\n')
      if (rest) buf = rest + '\n\n'
      continue
    }
    if (buf.length + para.length > MAX) flush()
    // A single paragraph longer than a passage: cut on sentence ends.
    if (para.length > MAX) {
      for (const piece of para.match(/[\s\S]{1,1000}(?:[.!?]\s|$)/g) ?? [para]) {
        buf = piece
        flush()
      }
      continue
    }
    buf += para + '\n\n'
  }
  flush()
  return out
}

// ---------- Sources ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return (await res.json()) as T
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

/** Every article of the EVE University wiki, 50 per request, gently (one request at a time). */
async function fetchUni(onPage: (done: number) => void): Promise<Chunk[]> {
  const chunks: Chunk[] = []
  let cont: Record<string, string> = {}
  let pages = 0
  for (let guard = 0; guard < 400; guard++) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'allpages',
      gapnamespace: '0',
      gapfilterredir: 'nonredirects',
      gaplimit: '50',
      prop: 'revisions',
      rvprop: 'content|timestamp',
      rvslots: 'main',
      ...cont
    })
    const r = await getJson<{
      continue?: Record<string, string>
      query?: { pages: { title: string; revisions?: { timestamp: string; slots: { main: { content?: string } } }[] }[] }
    }>(`${WIKI}/api.php?${params}`)
    for (const p of r.query?.pages ?? []) {
      const rev = p.revisions?.[0]
      const raw = rev?.slots.main.content
      if (!raw) continue
      const url = `${WIKI}/${encodeURIComponent(p.title.replace(/ /g, '_'))}`
      chunks.push(...split(wikiText(raw), { src: 'uni', title: p.title, url, date: rev.timestamp.slice(0, 10) }, (s) => `${url}#${encodeURIComponent(s.replace(/ /g, '_'))}`))
      pages++
    }
    onPage(pages)
    if (!r.continue) break
    cont = r.continue
    await sleep(400)
  }
  return chunks
}

/** Plain text of a Contentful rich-text document (the body of eveonline.com articles). */
function richText(node: { nodeType?: string; value?: string; content?: unknown[] }): string {
  if (node.nodeType === 'text') return node.value ?? ''
  const inner = (node.content ?? []).map((c) => richText(c as typeof node)).join('')
  const h = /^heading-(\d)$/.exec(node.nodeType ?? '')
  if (h) return `\n${'='.repeat(Math.min(4, Number(h[1])))} ${inner.trim()}\n\n`
  if (node.nodeType === 'list-item') return `- ${inner.trim()}\n`
  if (node.nodeType === 'paragraph') return `${inner}\n\n`
  if (node.nodeType === 'table-row') return `${(node.content ?? []).map((c) => richText(c as typeof node).trim()).join(' | ')}\n`
  return inner
}

/** The rich-text document embedded in an eveonline.com news page (the page's own data). */
function articleDocument(html: string): string | null {
  const at = html.indexOf('"nodeType":"document"')
  if (at < 0) return null
  const start = html.lastIndexOf('{', at)
  // Walk to the matching brace, skipping braces inside strings.
  let depth = 0
  let inStr = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try {
        return richText(JSON.parse(html.slice(start, i + 1)))
      } catch {
        return null
      }
    }
  }
  return null
}

/** CCP news from the RSS feed (full text) and every patch notes / expansion notes page. */
async function fetchCcp(): Promise<Chunk[]> {
  const chunks: Chunk[] = []
  const seen = new Set<string>()
  const rss = await getText('https://www.eveonline.com/rss')
  for (const item of rss.split('<item>').slice(1)) {
    const tag = (t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(item)?.[1]?.trim() ?? ''
    const url = tag('link')
    const title = decodeHtml(tag('title'))
    const date = tag('pubDate') ? new Date(tag('pubDate')).toISOString().slice(0, 10) : undefined
    const body = decodeHtml(decodeHtml(tag('description')))
    if (!url || !body) continue
    seen.add(url)
    chunks.push(...split(body, { src: 'ccp', title, url, date }, () => url))
  }
  const listing = await getText('https://www.eveonline.com/news/t/patch-notes')
  const links = [...new Set(listing.match(/news\/view\/[a-z0-9-]*(?:patch-notes|expansion-notes)[a-z0-9-]*/g) ?? [])]
  for (const path of links) {
    const url = `https://www.eveonline.com/${path}`
    if (seen.has(url)) continue
    try {
      const html = await getText(url)
      const text = articleDocument(html)
      const title =
        decodeHtml(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/.exec(html)?.[1] ?? /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1] ?? '').replace(/\s*\|\s*EVE Online\s*$/i, '') ||
        path.replace('news/view/', '').replace(/-/g, ' ')
      const date = /"publishingDate":"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1]
      if (text) chunks.push(...split(text, { src: 'ccp', title, url, date }, () => url))
    } catch {
      // One page failing doesn't stop the rest.
    }
    await sleep(400)
  }
  return chunks
}

// ---------- Update ----------

const notify = (sender: WebContents | null): void => {
  if (sender && !sender.isDestroyed()) sender.send('knowledge:status', status())
}

/** Downloads the sources again (each kept as it was when its download fails). */
export function update(sender: WebContents | null): Promise<void> {
  if (updating) return updating
  updating = (async () => {
    const s = load()
    const next: Store = { format: FORMAT, updated: { ...s.updated }, chunks: s.chunks }
    try {
      progress = { source: 'ccp', done: 0 }
      notify(sender)
      const ccp = await fetchCcp().catch((e) => (console.error('[knowledge] ccp', e), null))
      if (ccp?.length) {
        next.chunks = [...next.chunks.filter((c) => c.src !== 'ccp'), ...ccp]
        next.updated.ccp = new Date().toISOString()
      }
      progress = { source: 'uni', done: 0 }
      notify(sender)
      const uni = await fetchUni((done) => {
        progress = { source: 'uni', done, total: 4600 }
        notify(sender)
      }).catch((e) => (console.error('[knowledge] uni', e), null))
      if (uni?.length) {
        next.chunks = [...next.chunks.filter((c) => c.src !== 'uni'), ...uni]
        next.updated.uni = new Date().toISOString()
      }
      save(next)
      store = next
      index = null
    } finally {
      updating = null
      progress = undefined
      notify(sender)
    }
  })()
  return updating
}

/** Refreshes in the background when the base is a week old (or missing). */
export function refreshIfStale(sender: WebContents | null): void {
  const u = load().updated
  const oldest = Math.min(Date.parse(u.uni ?? '0'), Date.parse(u.ccp ?? '0'))
  if (Date.now() - oldest > WEEK) void update(sender)
}

// ---------- Search (BM25) ----------

interface Index {
  docs: Chunk[]
  /** term → [doc, frequency] pairs */
  postings: Map<string, [number, number][]>
  lengths: Float32Array
  avg: number
}

const STOP = new Set('the a an and or of to in on for is are be with as at by it its this that from you your can will not no if into than then also only more most other some such these those which who what when where how all any each both few'.split(' '))

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9а-яё]+(?:['’][a-z]+)?/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t)).map(stem)
}

/** Crude English stemming so "penalties" finds "penalty" and "webs" finds "web". */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (t.length > 4 && t.endsWith('es') && /(ss|x|ch|sh)es$/.test(t)) return t.slice(0, -2)
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1)
  return t
}

function build(): Index {
  const notes: Chunk[] = NOTES.map((n) => ({ src: 'notes', title: n.title, url: 'canopus://notes', text: n.text }))
  const docs = [...notes, ...load().chunks]
  const postings = new Map<string, [number, number][]>()
  const lengths = new Float32Array(docs.length)
  docs.forEach((d, i) => {
    // The title and section count three times: a passage of "Stacking penalties" is about stacking penalties.
    const words = [...tokens(d.text), ...Array(3).fill(tokens(`${d.title} ${d.section ?? ''}`)).flat()]
    lengths[i] = words.length
    const tf = new Map<string, number>()
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1)
    for (const [w, f] of tf) (postings.get(w) ?? postings.set(w, []).get(w)!).push([i, f])
  })
  const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, docs.length)
  return { docs, postings, lengths, avg }
}

export function search(query: string, limit = 6, source?: Chunk['src']): KnowledgeHit[] {
  index ??= build()
  const { docs, postings, lengths, avg } = index
  const k1 = 1.2
  const b = 0.75
  const scores = new Map<number, number>()
  for (const term of new Set(tokens(query))) {
    const list = postings.get(term)
    if (!list) continue
    const idf = Math.log(1 + (docs.length - list.length + 0.5) / (list.length + 0.5))
    for (const [doc, f] of list) {
      if (source && docs[doc].src !== source) continue
      const s = idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * lengths[doc]) / avg)))
      scores.set(doc, (scores.get(doc) ?? 0) + s)
    }
  }
  // At most two passages of one article, so a few results cover several pages.
  const perTitle = new Map<string, number>()
  const out: KnowledgeHit[] = []
  for (const [doc] of [...scores.entries()].sort((x, y) => y[1] - x[1])) {
    const d = docs[doc]
    const n = perTitle.get(d.title) ?? 0
    if (n >= 2) continue
    perTitle.set(d.title, n + 1)
    out.push({ source: d.src === 'uni' ? 'EVE University wiki' : d.src === 'ccp' ? 'CCP (eveonline.com)' : 'Canopus notes', title: d.title, section: d.section, url: d.url, date: d.date, text: d.text })
    if (out.length >= limit) break
  }
  return out
}

export const hasBase = (): boolean => existsSync(storePath())
