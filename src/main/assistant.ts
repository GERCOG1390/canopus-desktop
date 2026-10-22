// OpenAI access for the assistant, two ways to pay:
// - "Sign in with ChatGPT": the user's Plus/Pro plan (OAuth with PKCE, a loopback callback on 127.0.0.1,
//   the client registered dynamically on the first sign-in);
// - the user's own API key.
// Credentials never leave the main process: they are stored encrypted with the OS keychain (like the
// EVE tokens) and only sent to auth.openai.com / api.openai.com. Requests use the Responses API, streamed.

import { app, safeStorage, shell, type WebContents } from 'electron'
import { createHash, createPublicKey, randomBytes, randomUUID, verify, type JsonWebKeyInput } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { AssistantAccount, AssistantTurn, ResponseItem, ToolDef } from '../shared/assistant'

const API = 'https://api.openai.com/v1'
const AUTH = 'https://auth.openai.com'
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
const CALLBACK_PATH = '/auth/callback'

// ---------- Encrypted storage ----------

const file = (name: string): string => join(app.getPath('userData'), name)

function readSecret<T>(name: string): T | null {
  try {
    if (!existsSync(file(name))) return null
    const raw = readFileSync(file(name))
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')) as T
  } catch {
    return null
  }
}

function writeSecret(name: string, value: unknown): void {
  const json = JSON.stringify(value)
  writeFileSync(file(name), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8'), { mode: 0o600 })
}

const removeFile = (name: string): void => {
  if (existsSync(file(name))) rmSync(file(name))
}

// ---------- API key ----------

const loadKey = (): string | null => readSecret<{ key: string }>('assistant-key.bin')?.key ?? null

/** Saves the key after checking it works (lists the account's models). */
export async function setKey(key: string): Promise<string[]> {
  const models = await fetchModels(key.trim())
  writeSecret('assistant-key.bin', { key: key.trim() })
  return models
}

export const clearKey = (): void => removeFile('assistant-key.bin')

// ---------- Sign in with ChatGPT ----------

interface ChatGptCredential {
  email?: string
  subject?: string
  client_id: string
  id_token?: string
  access_token?: string
  refresh_token?: string
  /** Epoch ms */
  expires_at?: number
  scopes?: string[]
}

/** A stable id for this computer's Canopus, sent with every authorization (OpenAI's ext_agent_host_id). */
function hostId(): string {
  const p = file('chatgpt-host.json')
  try {
    const saved = JSON.parse(readFileSync(p, 'utf8')) as { id?: string }
    if (saved.id) return saved.id
  } catch {
    // First run: create one below.
  }
  const id = `urn:uuid:${randomUUID()}`
  writeFileSync(p, JSON.stringify({ id }))
  return id
}

const loadChatGpt = (): ChatGptCredential | null => readSecret<ChatGptCredential>('assistant-chatgpt.bin')
const saveChatGpt = (c: ChatGptCredential): void => writeSecret('assistant-chatgpt.bin', c)

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function decodeJwt(token: string): {
  header: Record<string, string>
  payload: Record<string, unknown>
} {
  const [h, p] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
  }
}

/** Checks the ID token: signature against OpenAI's published keys, issuer, audience, expiry and nonce. */
async function validateIdToken(idToken: string, clientId: string, nonce: string): Promise<Record<string, unknown>> {
  const { header, payload } = decodeJwt(idToken)
  const config = (await (await fetch(`${AUTH}/.well-known/openid-configuration`)).json()) as { jwks_uri: string; issuer: string }
  const jwks = (await (await fetch(config.jwks_uri)).json()) as {
    keys: (Record<string, string> & { kid: string })[]
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid)
  if (!jwk) throw new Error('Не найден ключ подписи OpenAI для токена')
  const [h, p, sig] = idToken.split('.')
  const ok = verify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    createPublicKey({ key: jwk, format: 'jwk' } as unknown as JsonWebKeyInput),
    Buffer.from(sig, 'base64url')
  )
  if (!ok) throw new Error('Подпись токена OpenAI не прошла проверку')
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (payload.iss !== config.issuer) throw new Error('Токен выдан не OpenAI')
  if (!aud.includes(clientId)) throw new Error('Токен выдан другому приложению')
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() - 60_000) throw new Error('Токен OpenAI просрочен')
  if (payload.nonce !== nonce) throw new Error('Неверный nonce в токене OpenAI')
  return payload
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${AUTH}/api/accounts/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
  const json = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || json.error) {
    console.error(`[assistant] token ${res.status}: ${json.error ?? ''} ${json.error_description ?? ''}`)
    const err = new Error(json.error_description || json.error || `HTTP ${res.status}`) as Error & { code?: string }
    err.code = json.error
    throw err
  }
  return json
}

let pendingLogin: { server: Server; reject: (e: Error) => void } | null = null

export function cancelChatGptLogin(): void {
  if (!pendingLogin) return
  pendingLogin.server.close()
  pendingLogin.reject(new Error('Вход отменён'))
  pendingLogin = null
}

const DONE_PAGE = (ok: boolean, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Canopus</title><body style="font:16px system-ui;background:#131416;color:#e8e8ea;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:40px">${ok ? '✔' : '✕'}</div><p>${text}</p></div></body>`

/** Opens the ChatGPT sign-in in the browser and waits for the result on a loopback port. */
export async function chatGptLogin(): Promise<AssistantAccount> {
  cancelChatGptLogin()
  const saved = loadChatGpt()
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  const nonce = b64url(randomBytes(16))
  const host = hostId()

  const { code, issuedClientId, redirectUri } = await new Promise<{
    code: string
    issuedClientId?: string
    redirectUri: string
  }>((resolve, reject) => {
    let redirectUri = ''
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      const finish = (ok: boolean, text: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE(ok, text))
        server.close()
        pendingLogin = null
      }
      if (url.searchParams.get('state') !== state) {
        finish(false, 'Неверный ответ входа. Попробуйте ещё раз из Canopus.')
        reject(new Error('Неверный state в ответе OpenAI'))
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        finish(false, 'Вход не выполнен. Можно закрыть эту вкладку.')
        reject(new Error(url.searchParams.get('error_description') || error))
        return
      }
      finish(true, 'Готово — можно закрыть эту вкладку и вернуться в Canopus.')
      resolve({
        code: url.searchParams.get('code') ?? '',
        issuedClientId: url.searchParams.get('client_id') ?? undefined,
        redirectUri
      })
    })
    pendingLogin = { server, reject }
    // OpenAI's example port first; any free port works for later sign-ins (same scheme, host and path).
    const listen = (port: number) => {
      server.once('error', () => (port ? listen(0) : reject(new Error('Не удалось открыть локальный порт для входа'))))
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address()
        const p = typeof addr === 'object' && addr ? addr.port : port
        redirectUri = `http://127.0.0.1:${p}${CALLBACK_PATH}`
        const params = new URLSearchParams({
          client_id: saved?.client_id ?? 'dynamic_agent_client',
          ext_agent_host_id: host,
          response_type: 'code',
          redirect_uri: redirectUri,
          scope: SCOPE,
          resource: `${API}`,
          state,
          nonce,
          code_challenge: challenge,
          code_challenge_method: 'S256'
        })
        if (!saved?.client_id) params.set('agent_name_hint', 'Canopus')
        if (saved?.email) params.set('login_hint', saved.email)
        void shell.openExternal(`${AUTH}/api/accounts/authorize?${params.toString()}`)
      })
    }
    listen(1455)
    // Nobody finished the sign-in in 10 minutes: free the port.
    setTimeout(() => {
      if (pendingLogin?.server === server) cancelChatGptLogin()
    }, 10 * 60_000)
  })

  const clientId = saved?.client_id ?? issuedClientId
  if (!clientId || clientId === 'dynamic_agent_client') throw new Error('OpenAI не завершил регистрацию Canopus: попробуйте войти ещё раз')
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: API
  })
  const claims = t.id_token ? await validateIdToken(t.id_token, clientId, nonce) : {}
  const scopes = (t.scope ?? '').split(/\s+/).filter(Boolean)
  saveChatGpt({
    client_id: clientId,
    email: claims.email as string | undefined,
    subject: claims.sub as string | undefined,
    id_token: t.id_token,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in ?? 3600) * 1000,
    scopes
  })
  return account()
}

/** Signs out: the tokens go, the registered client id stays for the next sign-in. */
export function chatGptLogout(): void {
  const c = loadChatGpt()
  if (c) saveChatGpt({ client_id: c.client_id })
}

async function chatGptToken(): Promise<string> {
  const c = loadChatGpt()
  if (!c?.access_token) throw new Error('Войдите через ChatGPT')
  if (!c.scopes?.includes(PLAN_SCOPE)) throw new Error('При входе не разрешено использовать план ChatGPT: войдите ещё раз и оставьте эту галочку')
  if ((c.expires_at ?? 0) > Date.now() + 60_000) return c.access_token
  if (!c.refresh_token) throw new Error('Сессия ChatGPT истекла: войдите ещё раз')
  try {
    const t = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: c.client_id,
      refresh_token: c.refresh_token,
      resource: API
    })
    // The refresh token rotates: replace everything together.
    saveChatGpt({
      ...c,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? c.refresh_token,
      id_token: t.id_token ?? c.id_token,
      expires_at: Date.now() + (t.expires_in ?? 3600) * 1000,
      scopes: t.scope ? t.scope.split(/\s+/) : c.scopes
    })
    return t.access_token
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    if (/invalid_grant|invalid_refresh_token|token_expired|refresh_token_/.test(code)) {
      chatGptLogout()
      throw new Error('Сессия ChatGPT закончилась: войдите ещё раз')
    }
    throw e
  }
}

// ---------- Which account is used ----------

export function account(): AssistantAccount {
  const c = loadChatGpt()
  return {
    chatgpt: c?.access_token ? { email: c.email, plan: !!c.scopes?.includes(PLAN_SCOPE) } : null,
    apiKey: !!loadKey()
  }
}

async function bearer(mode: 'chatgpt' | 'apikey'): Promise<string> {
  if (mode === 'chatgpt') return chatGptToken()
  const key = loadKey()
  if (!key) throw new Error('Не задан ключ OpenAI API')
  return key
}

// ---------- Requests ----------

function apiError(status: number, text: string): Error {
  let msg = text
  let code = ''
  try {
    const e = JSON.parse(text).error
    msg = e?.message ?? text
    code = e?.code ?? e?.type ?? ''
  } catch {
    /* plain text error */
  }
  // The usual cases in plain words; anything else as OpenAI wrote it.
  if (code === 'subscription_sharing_usage_limit_exceeded')
    return new Error('Лимит плана ChatGPT для Canopus исчерпан. Посмотреть и изменить лимит: ChatGPT → Настройки → Usage.')
  if (code === 'subscription_sharing_user_not_eligible')
    return new Error('Этот аккаунт ChatGPT не может делиться планом с приложениями: нужна подписка Plus или Pro.')
  if (status === 401) return new Error('OpenAI не принял вход или ключ: войдите заново или проверьте ключ')
  if (status === 429 && /credit|quota|billing/i.test(msg))
    return new Error(
      'На аккаунте OpenAI API закончились средства: пополните баланс на platform.openai.com/settings/organization/billing (API оплачивается отдельно от подписки ChatGPT).'
    )
  if (status === 429) return new Error('OpenAI просит подождать: слишком много запросов. Попробуйте через минуту.')
  return new Error(`OpenAI ${status}: ${msg}`)
}

async function fetchModels(token: string): Promise<string[]> {
  const res = await fetch(`${API}/models`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`[assistant] models ${res.status}: ${text.slice(0, 500)}`)
    throw apiError(res.status, text)
  }
  const r = JSON.parse(text) as {
    data?: { id: string; created: number }[]
    models?: { slug: string; visibility?: string }[]
  }
  // The ChatGPT plan catalog: { models: [{ slug, visibility }] }; the API: { data: [{ id }] }.
  if (r.models) return r.models.filter((m) => !m.visibility || m.visibility === 'list').map((m) => m.slug)
  return (
    (r.data ?? [])
      .filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct|codex)/.test(m.id))
      // Main models ("gpt-5.5") before dated snapshots and mini/nano variants, newest first within each.
      .sort((a, b) => Number(/^gpt-[\d.]+$/.test(b.id)) - Number(/^gpt-[\d.]+$/.test(a.id)) || b.created - a.created)
      .map((m) => m.id)
  )
}

export async function listModels(mode: 'chatgpt' | 'apikey'): Promise<string[]> {
  return fetchModels(await bearer(mode))
}

/**
 * One model turn: streams the text to `sender` as it arrives (channel `assistant:delta`) and returns
 * every output item (messages, function calls, reasoning) to resend with the next turn.
 */
export async function respond(
  sender: WebContents,
  requestId: string,
  mode: 'chatgpt' | 'apikey',
  model: string,
  instructions: string,
  input: ResponseItem[],
  tools: ToolDef[],
  webSearch: boolean
): Promise<AssistantTurn> {
  const token = await bearer(mode)
  const send = (web: boolean) =>
    fetch(`${API}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({
        model,
        instructions,
        input,
        tools: [
          // Plan usage only takes function tools grouped in a namespace.
          {
            type: 'namespace',
            name: 'canopus',
            description: 'Canopus app: live EVE Online data, its engines and app actions',
            tools: tools.map((t) => ({ type: 'function', ...t.function }))
          },
          // OpenAI's own web search, for what Canopus has no data on (patch notes, guides, news).
          ...(web ? [{ type: 'web_search' }] : [])
        ],
        tool_choice: 'auto',
        parallel_tool_calls: true,
        store: false,
        stream: true,
        // Reasoning carried between turns without server-side storage.
        include: ['reasoning.encrypted_content']
      })
    })
  let res = await send(webSearch)
  let webSearchUnavailable = false
  // Web search depends on the model and the account's policy: without it the assistant still works.
  if (webSearch && res.status === 400) {
    const text = await res.text()
    if (!/web_search/i.test(text)) throw apiError(400, text)
    console.error(`[assistant] web search unavailable: ${text.slice(0, 300)}`)
    webSearchUnavailable = true
    res = await send(false)
  }
  if (!res.ok || !res.body) {
    const text = await res.text()
    console.error(`[assistant] responses ${res.status}: ${text.slice(0, 800)}`)
    throw apiError(res.status, text)
  }

  const output: ResponseItem[] = []
  let usage: AssistantTurn['usage']
  let completed = false
  let buf = ''
  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (!data || data === '[DONE]') continue
      const ev = JSON.parse(data) as {
        type: string
        delta?: string
        item?: ResponseItem
        response?: {
          output?: ResponseItem[]
          usage?: AssistantTurn['usage']
          error?: { code?: string; message?: string }
        }
        error?: { code?: string; message?: string }
        code?: string
        message?: string
      }
      if (ev.type === 'response.output_text.delta' && ev.delta && !sender.isDestroyed()) sender.send('assistant:delta', { id: requestId, delta: ev.delta })
      else if (ev.type === 'response.output_item.done' && ev.item) output.push(ev.item)
      else if (ev.type === 'response.completed') {
        completed = true
        usage = ev.response?.usage
      } else if (ev.type === 'response.failed' || ev.type === 'error') {
        const err = ev.response?.error ?? ev.error ?? { code: ev.code, message: ev.message }
        throw apiError(err.code === 'subscription_sharing_usage_limit_exceeded' ? 429 : 500, JSON.stringify({ error: err }))
      }
    }
  }
  if (!completed) throw new Error('Ответ OpenAI оборвался: попробуйте ещё раз')
  return { output, usage, webSearchUnavailable }
}
