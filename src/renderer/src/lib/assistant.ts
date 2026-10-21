// The assistant's conversation: lives outside React so it keeps going while the user switches
// sections (and while a tool opens a fit or a page), and survives the panel being closed.

import type { AssistantAuth, ResponseItem } from '../../../shared/assistant'
import { runTool, TOOL_DEFS, type ToolContext } from './assistantTools'

/** Rounds of tool calls in one answer before giving up (a loop guard). */
const MAX_ROUNDS = 14
const STORE_KEY = 'canopus.assistant.chat.v2'

function systemPrompt(ctx: ToolContext): string {
  return [
    'You are the assistant built into Canopus, a desktop companion app for the game EVE Online.',
    `Answer in ${ctx.lang === 'ru' ? 'Russian' : 'English'} unless the user writes in another language; keep EVE item, ship and skill names in English as in the game.`,
    `Today is ${new Date().toISOString().slice(0, 10)} (EVE time is UTC). The logged-in characters: ${ctx.characters.map((c) => c.name).join(', ') || 'none'}; active: ${ctx.active?.name ?? 'none'}.`,
    'You have tools that read live data from Canopus and the game (characters, skills, assets, wallet, fits, market prices, routes, kills) and that compute with Canopus\' own engines (the dogma fitting engine with the game formulas, the combat simulator, the price optimizer).',
    'Rules:',
    '- Never guess numbers that a tool can compute or fetch: fit stats, DPS, EHP, capacitor, prices, training times, routes, kills. Call the tool, then answer from its result. Your own knowledge of EVE may be outdated; the tools reflect the current game data.',
    "- When the user mentions their ship or fit (\"my Cerberus\"), find it yourself: the fit open in the fitting tool, then list_fits in Canopus and in the game. If several match, take the most plausible, say which one you used, and go on; ask only when nothing fits. The same for other missing details: make a sensible assumption, state it, answer, and offer to recompute.",
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
  /** What the model sees (Responses API items, without the instructions) */
  history: ResponseItem[]
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

/** Text of the assistant messages among a turn's output items. */
function textOf(items: ResponseItem[]): string {
  return items
    .flatMap((i) => (i.type === 'message' || (!i.type && 'role' in i) ? (typeof i.content === 'string' ? [i.content] : i.content.filter((c) => c.type === 'output_text').map((c) => c.text ?? '')) : []))
    .join('')
}

/**
 * Earlier questions of the conversation as the user saw them: the question and the final answer. Tool
 * calls, their (often large) results and reasoning are dropped, so a long chat doesn't resend all the data
 * of every earlier answer; the model calls a tool again when it needs fresh numbers.
 */
function compact(history: ResponseItem[]): ResponseItem[] {
  const out: ResponseItem[] = []
  for (const i of history) {
    if (i.type === 'function_call' || i.type === 'function_call_output' || i.type === 'reasoning') continue
    if (!('role' in i)) continue
    if (i.role === 'user') out.push({ role: 'user', content: typeof i.content === 'string' ? i.content : textOf([i]) })
    else if (i.role === 'assistant') {
      const text = textOf([i])
      // Several assistant messages of one answer (between tool rounds) become one.
      const last = out[out.length - 1]
      if (last && 'role' in last && last.role === 'assistant') last.content = `${last.content}\n\n${text}`
      else if (text) out.push({ role: 'assistant', content: text })
    }
  }
  return out
}

/**
 * The previous question keeps its tool data (a follow-up like "and with other ammo?" needs the same fits),
 * older ones are compacted to question and answer.
 */
function keepLastTurn(history: ResponseItem[]): ResponseItem[] {
  let last = -1
  history.forEach((i, k) => {
    if ('role' in i && i.role === 'user') last = k
  })
  return last <= 0 ? history : [...compact(history.slice(0, last)), ...history.slice(last)]
}

/** Items go back to the model as received, minus ids: nothing is stored on OpenAI's side (store: false). */
const resend = (i: ResponseItem): ResponseItem => (i.type === 'reasoning' || !('id' in i) ? i : (({ id: _id, ...rest }) => rest as ResponseItem)(i))

export async function ask(text: string, mode: AssistantAuth, model: string, confirm: (t: string) => Promise<boolean>): Promise<void> {
  if (state.busy || !text.trim() || !currentCtx) return
  const entry: ChatEntry = { role: 'assistant', text: '', steps: [] }
  const history: ResponseItem[] = [...keepLastTurn(state.history), { role: 'user', content: text.trim() }]
  set({ busy: true, entries: [...state.entries, { role: 'user', text: text.trim() }, entry], history })
  const update = (patch: Partial<ChatEntry>) => {
    Object.assign(entry, patch)
    set({ entries: [...state.entries.slice(0, -1), { ...entry, steps: [...(entry.steps ?? [])] }] })
  }
  // Text of earlier rounds of this answer, and the stream of the current one.
  let before = ''
  let live = ''
  let requestId = ''
  const off = window.api.assistant.onDelta((id, delta) => {
    if (id !== requestId) return
    live += delta
    update({ text: before + live })
  })
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      requestId = `${Date.now()}-${round}`
      live = ''
      const turn = await window.api.assistant.respond(requestId, mode, model, systemPrompt(currentCtx), history.map(resend), TOOL_DEFS)
      history.push(...turn.output)
      state.tokens += turn.usage?.total_tokens ?? 0
      const said = textOf(turn.output)
      if (said) before = (before ? before + '\n\n' : '') + said
      update({ text: before })
      const calls = turn.output.filter((i): i is Extract<ResponseItem, { type: 'function_call' }> => i.type === 'function_call')
      if (!calls.length) break
      update({ steps: [...(entry.steps ?? []), ...calls.map((c) => ({ id: c.call_id, name: c.name, args: c.arguments }))] })
      const results = await Promise.all(calls.map((c) => runTool(c.name, c.arguments, currentCtx!, confirm)))
      calls.forEach((c, i) => {
        history.push({ type: 'function_call_output', call_id: c.call_id, output: results[i] })
        const step = entry.steps?.find((st) => st.id === c.call_id)
        if (step) step.result = results[i]
      })
      update({})
      if (round === MAX_ROUNDS - 1) update({ text: (entry.text ? entry.text + '\n\n' : '') + '(Остановился: слишком много шагов подряд. Уточните вопрос.)' })
    }
    set({ history, busy: false })
  } catch (e) {
    // The failed turn is dropped from what the model sees, so the next question starts clean.
    set({ busy: false, entries: [...state.entries, { role: 'error', text: (e as Error).message }] })
  } finally {
    off()
  }
}
