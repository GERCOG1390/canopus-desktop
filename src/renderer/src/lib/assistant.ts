// The assistant's conversation: lives outside React so it keeps going while the user switches
// sections (and while a tool opens a fit or a page), and survives the panel being closed.

import type { ChatMessage } from '../../../shared/assistant'
import { runTool, TOOL_DEFS, type ToolContext } from './assistantTools'

/** Rounds of tool calls in one answer before giving up (a loop guard). */
const MAX_ROUNDS = 14
const STORE_KEY = 'canopus.assistant.chat'

function systemPrompt(ctx: ToolContext): string {
  return [
    'You are the assistant built into Canopus, a desktop companion app for the game EVE Online.',
    `Answer in ${ctx.lang === 'ru' ? 'Russian' : 'English'} unless the user writes in another language; keep EVE item, ship and skill names in English as in the game.`,
    `Today is ${new Date().toISOString().slice(0, 10)} (EVE time is UTC). The logged-in characters: ${ctx.characters.map((c) => c.name).join(', ') || 'none'}; active: ${ctx.active?.name ?? 'none'}.`,
    'You have tools that read live data from Canopus and the game (characters, skills, assets, wallet, fits, market prices, routes, kills) and that compute with Canopus\' own engines (the dogma fitting engine with the game formulas, the combat simulator, the price optimizer).',
    'Rules:',
    '- Never guess numbers that a tool can compute or fetch: fit stats, DPS, EHP, capacitor, prices, training times, routes, kills. Call the tool, then answer from its result. Your own knowledge of EVE may be outdated; the tools reflect the current game data.',
    '- When you propose a fit, write it in EFT, check it with calculate_fit (it must fit CPU/powergrid and the character should have the skills, or say which are missing), fix problems, and offer to open it with open_fit.',
    '- Use exact English item names in EFT; look names up with search_items when unsure.',
    '- Prices are Jita sell orders unless the user asks otherwise; give ISK with M/B suffixes.',
    '- You may open Canopus sections and fits (navigate, open_fit) when it helps the user see the result. Actions in the game client (set_destination, save_fit_to_game) need a clear request from the user; the app also asks them to confirm.',
    '- Canopus never sends keyboard or mouse input to the game and does not automate gameplay; do not offer to.',
    '- Be concise and practical: short paragraphs, lists, small tables. Put fits in ``` code blocks.'
  ].join('\n')
}

export interface ToolStep {
  id: string
  name: string
  args: string
  result?: string
}

export interface ChatEntry {
  role: 'user' | 'assistant' | 'error'
  text: string
  steps?: ToolStep[]
}

interface State {
  /** What the user sees */
  entries: ChatEntry[]
  /** What the model sees (OpenAI format, without the system message) */
  history: ChatMessage[]
  busy: boolean
  tokens: number
}

let state: State = load()
const listeners = new Set<() => void>()

function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    if (saved?.entries && saved?.history) return { entries: saved.entries, history: saved.history, busy: false, tokens: saved.tokens ?? 0 }
  } catch {
    // Browser storage is a convenience only.
  }
  return { entries: [], history: [], busy: false, tokens: 0 }
}

function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ entries: state.entries, history: state.history, tokens: state.tokens }))
  } catch {
    // Full or blocked storage: the chat still works for this session.
  }
  listeners.forEach((l) => l())
}

export const assistantState = (): State => state
export function subscribeAssistant(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function clearChat(): void {
  if (!state.busy) set({ entries: [], history: [], tokens: 0 })
}

/** The latest app context, updated by the panel on every render (tools read it while running). */
let currentCtx: ToolContext | null = null
export const setAssistantContext = (ctx: ToolContext): void => void (currentCtx = ctx)

export async function ask(text: string, model: string, confirm: (t: string) => Promise<boolean>): Promise<void> {
  if (state.busy || !text.trim() || !currentCtx) return
  const entry: ChatEntry = { role: 'assistant', text: '', steps: [] }
  const history: ChatMessage[] = [...state.history, { role: 'user', content: text.trim() }]
  set({ busy: true, entries: [...state.entries, { role: 'user', text: text.trim() }, entry], history })
  const update = (patch: Partial<ChatEntry>) => {
    Object.assign(entry, patch)
    set({ entries: [...state.entries.slice(0, -1), { ...entry, steps: [...(entry.steps ?? [])] }] })
  }
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await window.api.assistant.complete(model, [{ role: 'system', content: systemPrompt(currentCtx) }, ...history], TOOL_DEFS)
      history.push(res.message)
      state.tokens += res.usage?.total_tokens ?? 0
      if (res.message.content) update({ text: res.message.content })
      if (!res.message.tool_calls?.length) break
      const calls = res.message.tool_calls
      update({ steps: [...(entry.steps ?? []), ...calls.map((c) => ({ id: c.id, name: c.function.name, args: c.function.arguments }))] })
      const results = await Promise.all(calls.map((c) => runTool(c.function.name, c.function.arguments, currentCtx!, confirm)))
      calls.forEach((c, i) => {
        history.push({ role: 'tool', tool_call_id: c.id, content: results[i] })
        const step = entry.steps?.find((s) => s.id === c.id)
        if (step) step.result = results[i]
      })
      update({})
      if (round === MAX_ROUNDS - 1) update({ text: (entry.text ? entry.text + '\n\n' : '') + '(Остановился: слишком много шагов подряд. Уточните вопрос.)' })
    }
    set({ history, busy: false })
  } catch (e) {
    // The failed turn is dropped from what the model sees, so the next question starts clean.
    set({ busy: false, entries: [...state.entries, { role: 'error', text: (e as Error).message }] })
  }
}
