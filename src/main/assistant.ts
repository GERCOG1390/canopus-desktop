// OpenAI access for the assistant. The API key never leaves the main process: it is stored encrypted
// with the OS keychain (like the EVE tokens) and only used for requests to api.openai.com.

import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, CompletionResult, ToolDef } from '../shared/assistant'

const API = 'https://api.openai.com/v1'
const keyPath = (): string => join(app.getPath('userData'), 'assistant.bin')

function loadKey(): string | null {
  try {
    if (!existsSync(keyPath())) return null
    const raw = readFileSync(keyPath())
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
  } catch {
    return null
  }
}

export const hasKey = (): boolean => !!loadKey()

/** Saves the key after checking it works (lists the account's models). */
export async function setKey(key: string): Promise<string[]> {
  const models = await listModels(key.trim())
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key.trim()) : Buffer.from(key.trim(), 'utf8')
  writeFileSync(keyPath(), data)
  return models
}

export function clearKey(): void {
  if (existsSync(keyPath())) rmSync(keyPath())
}

async function call<T>(path: string, init: RequestInit = {}, key = loadKey()): Promise<T> {
  if (!key) throw new Error('Не задан ключ OpenAI API')
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers } })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      msg = JSON.parse(text).error?.message ?? text
    } catch {
      /* plain text error */
    }
    // The usual cases in plain words; anything else as OpenAI wrote it.
    if (res.status === 401) throw new Error('OpenAI не принял ключ: проверьте его или создайте новый на platform.openai.com/api-keys')
    if (res.status === 429 && /credit|quota|billing/i.test(msg))
      throw new Error('На аккаунте OpenAI закончились средства: пополните баланс на platform.openai.com/settings/organization/billing (API оплачивается отдельно от подписки ChatGPT Plus).')
    if (res.status === 429) throw new Error('OpenAI просит подождать: слишком много запросов. Попробуйте через минуту.')
    throw new Error(`OpenAI ${res.status}: ${msg}`)
  }
  return JSON.parse(text) as T
}

/** Chat models the key can use (no audio, image, embedding or moderation models), newest names first. */
export async function listModels(key = loadKey()): Promise<string[]> {
  const r = await call<{ data: { id: string; created: number }[] }>('/models', {}, key)
  return r.data
    .filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct|codex)/.test(m.id))
    // Main models ("gpt-5.5") before dated snapshots and mini/nano variants, newest first within each.
    .sort((a, b) => Number(/^gpt-[\d.]+$/.test(b.id)) - Number(/^gpt-[\d.]+$/.test(a.id)) || b.created - a.created)
    .map((m) => m.id)
}

export async function complete(model: string, messages: ChatMessage[], tools: ToolDef[]): Promise<CompletionResult> {
  const r = await call<{ choices: { message: CompletionResult['message'] }[]; usage?: CompletionResult['usage'] }>('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', parallel_tool_calls: true })
  })
  const message = r.choices[0]?.message
  if (!message) throw new Error('OpenAI вернул пустой ответ')
  return { message: { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls?.length ? message.tool_calls : undefined }, usage: r.usage }
}
