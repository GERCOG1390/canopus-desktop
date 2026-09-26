import type { RequestOptions } from '../shared/types'
import { getAccessToken } from './auth'

export const USER_AGENT = 'Canopus/0.1.0 (EVE Online desktop companion)'

// The renderer may only reach these hosts through the main process.
const ALLOWED_HOSTS = new Set([
  'esi.evetech.net',
  'zkillboard.com',
  'market.fuzzwork.co.uk',
  'www.fuzzwork.co.uk',
  'api.eve-scout.com'
])

const DEFAULT_TTL_MS = 60_000
const cache = new Map<string, { expires: number; data: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

function cacheTtl(res: Response): number {
  const expires = res.headers.get('expires')
  if (expires) {
    // Some servers send several comma-joined Expires values; the last one wins.
    const parsed = Date.parse(expires.split(/,(?=\s*[A-Z][a-z]{2},)/).pop() ?? '')
    if (!Number.isNaN(parsed) && parsed > Date.now()) return Math.min(parsed - Date.now(), 3_600_000)
  }
  return DEFAULT_TTL_MS
}

async function fetchOnce(url: string, options: RequestOptions): Promise<{ data: unknown; pages: number; ttl: number }> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.characterId) headers.Authorization = `Bearer ${await getAccessToken(options.characterId)}`

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 300) || res.statusText
    try {
      message = JSON.parse(text).error ?? message
    } catch {
      // Non-JSON error body; keep the raw text.
    }
    throw new HttpError(res.status, `${res.status}: ${message}`)
  }
  return {
    data: text ? JSON.parse(text) : null,
    pages: Number(res.headers.get('x-pages') ?? 1),
    ttl: cacheTtl(res)
  }
}

async function doRequest(url: string, options: RequestOptions): Promise<unknown> {
  const first = await fetchOnce(url, options)
  if (!options.allPages || first.pages <= 1 || !Array.isArray(first.data)) {
    return { data: first.data, ttl: first.ttl }
  }
  const sep = url.includes('?') ? '&' : '?'
  const rest = await Promise.all(
    Array.from({ length: first.pages - 1 }, (_, i) => fetchOnce(`${url}${sep}page=${i + 2}`, options))
  )
  return { data: first.data.concat(...rest.map((r) => r.data as unknown[])), ttl: first.ttl }
}

export async function request(url: string, options: RequestOptions = {}): Promise<unknown> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Host not allowed: ${parsed.hostname}`)
  }
  if (options.characterId && parsed.hostname !== 'esi.evetech.net') {
    throw new Error('Access tokens are only sent to ESI')
  }

  const method = options.method ?? 'GET'
  const cacheable = method === 'GET'
  const key = `${options.characterId ?? 0}|${options.allPages ? 'all' : 'one'}|${url}`

  if (cacheable) {
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) return hit.data
    const pending = inflight.get(key)
    if (pending) return pending
  }

  const promise = doRequest(url, options).then((result) => {
    const { data, ttl } = result as { data: unknown; ttl: number }
    if (cacheable) cache.set(key, { data, expires: Date.now() + ttl })
    return data
  })
  if (cacheable) {
    inflight.set(key, promise)
    promise.finally(() => inflight.delete(key)).catch(() => {})
  }
  return promise
}
