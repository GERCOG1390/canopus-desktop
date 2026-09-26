// EVE SSO (OAuth 2.0 authorization code + PKCE) for a native desktop client.
// No client secret is needed: register the app at https://developers.eveonline.com
// with the callback URL below and paste its Client ID into Canopus settings.

import { shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { CharacterAuth } from '../shared/types'
import { loadSettings, loadTokens, saveTokens, type StoredToken } from './storage'

const AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize'
const TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
const CALLBACK_HOST = '127.0.0.1'
const CALLBACK_PORT = 51789
export const CALLBACK_URL = `http://${CALLBACK_HOST}:${CALLBACK_PORT}/callback`
const LOGIN_TIMEOUT_MS = 5 * 60_000

export const SCOPES = [
  'publicData',
  'esi-skills.read_skills.v1',
  'esi-skills.read_skillqueue.v1',
  'esi-wallet.read_character_wallet.v1',
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  'esi-assets.read_assets.v1',
  'esi-planets.manage_planets.v1',
  'esi-industry.read_character_jobs.v1',
  'esi-search.search_structures.v1',
  'esi-universe.read_structures.v1',
  'esi-killmails.read_killmails.v1',
  'esi-markets.read_character_orders.v1',
  'esi-ui.write_waypoint.v1'
]

let tokens: StoredToken[] = []
const refreshing = new Map<number, Promise<string>>()

export function initAuth(): void {
  tokens = loadTokens()
}

const base64url = (buf: Buffer): string => buf.toString('base64url')

function clientId(): string {
  const id = loadSettings().clientId.trim()
  if (!id) throw new Error('Укажите Client ID приложения EVE в настройках')
  return id
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Host: 'login.eveonline.com' },
    body: new URLSearchParams(params).toString()
  })
  if (!res.ok) throw new Error(`EVE SSO: ${res.status} ${await res.text()}`)
  return (await res.json()) as TokenResponse
}

// The token arrives directly from the SSO over TLS, so we read its claims
// without verifying the JWT signature.
function decodeJwt(token: string): { sub: string; name: string; scp?: string | string[] } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

function storeToken(res: TokenResponse): StoredToken {
  const claims = decodeJwt(res.access_token)
  const characterId = Number(claims.sub.split(':').pop())
  const scopes = claims.scp === undefined ? [] : Array.isArray(claims.scp) ? claims.scp : [claims.scp]
  const token: StoredToken = {
    characterId,
    characterName: claims.name,
    scopes,
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: Date.now() + res.expires_in * 1000
  }
  tokens = tokens.filter((t) => t.characterId !== characterId).concat(token)
  saveTokens(tokens)
  return token
}

function waitForCallback(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', CALLBACK_URL)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<html><body style="font-family:sans-serif;background:#0b0f14;color:#d6e2ee;text-align:center;padding-top:80px">` +
          `<h2>${ok ? 'Вход выполнен' : 'Ошибка входа'}</h2><p>Можно закрыть эту вкладку и вернуться в Canopus.</p></body></html>`
      )
      finish(ok ? null : new Error('EVE SSO вернул неверный ответ'), url.searchParams.get('code') ?? '')
    })
    const timer = setTimeout(() => finish(new Error('Время ожидания входа истекло'), ''), LOGIN_TIMEOUT_MS)
    function finish(err: Error | null, code: string): void {
      clearTimeout(timer)
      server.close()
      if (err) reject(err)
      else resolve(code)
    }
    server.on('error', (err) => finish(err, ''))
    server.listen(CALLBACK_PORT, CALLBACK_HOST)
  })
}

export async function login(): Promise<CharacterAuth> {
  const id = clientId()
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  const authUrl = new URL(AUTHORIZE_URL)
  authUrl.search = new URLSearchParams({
    response_type: 'code',
    redirect_uri: CALLBACK_URL,
    client_id: id,
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  }).toString()

  const codePromise = waitForCallback(state)
  await shell.openExternal(authUrl.toString())
  const code = await codePromise

  const token = storeToken(
    await tokenRequest({ grant_type: 'authorization_code', code, client_id: id, code_verifier: verifier })
  )
  return { id: token.characterId, name: token.characterName, scopes: token.scopes }
}

export function characters(): CharacterAuth[] {
  return tokens.map((t) => ({ id: t.characterId, name: t.characterName, scopes: t.scopes }))
}

export function logout(characterId: number): void {
  tokens = tokens.filter((t) => t.characterId !== characterId)
  saveTokens(tokens)
}

export async function getAccessToken(characterId: number): Promise<string> {
  const token = tokens.find((t) => t.characterId === characterId)
  if (!token) throw new Error('Персонаж не авторизован')
  if (token.expiresAt - 60_000 > Date.now()) return token.accessToken

  let pending = refreshing.get(characterId)
  if (!pending) {
    pending = tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refreshToken, client_id: clientId() })
      .then((res) => storeToken(res).accessToken)
      .finally(() => refreshing.delete(characterId))
    refreshing.set(characterId, pending)
  }
  return pending
}
