// The assistant panel: a chat docked on the right of the main window, next to whatever section is
// open, so the fits and pages the assistant opens show up beside the conversation.

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useApp } from '../AppContext'
import { useCharacter } from '../CharacterContext'
import { locale, translate } from '../i18n'
import { ask, assistantState, clearChat, setAssistantContext, subscribeAssistant, type ChatEntry } from '../lib/assistant'
import { TOOL_LABELS } from '../lib/assistantTools'
import { fromEft, useFitting } from '../lib/fitting'
import { fmtNum } from '../lib/format'
import type { AssistantAccount, AssistantAuth, KnowledgeStatus } from '../../../shared/assistant'

/** ChatGPT settings, where the user sees and limits what apps use from their plan. */
const MANAGE_USAGE = 'https://chatgpt.com/#settings'

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const char = useCharacter()
  const { fit, openFit } = useFitting()
  const s = useSyncExternalStore(subscribeAssistant, assistantState)
  const [account, setAccount] = useState<AssistantAccount | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [setup, setSetup] = useState(false)
  const [input, setInput] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const mode: AssistantAuth = app.settings?.assistant?.auth ?? 'chatgpt'
  const ready = mode === 'chatgpt' ? !!account?.chatgpt?.plan : !!account?.apiKey
  const model = (app.settings?.assistant?.model && models.includes(app.settings.assistant.model) ? app.settings.assistant.model : models[0]) || ''

  setAssistantContext({
    active: app.active,
    characters: app.characters,
    page: app.page,
    lang: app.settings?.lang ?? 'ru',
    char,
    fit,
    navigate: app.navigate,
    openFit: (f) => openFit(f)
  })

  const reload = () => void window.api.assistant.account().then(setAccount)
  useEffect(reload, [])
  const kb = useKnowledge()
  // The knowledge base downloads in the background the first time and refreshes weekly.
  useEffect(() => {
    if (ready) void window.api.knowledge.refreshIfStale()
  }, [ready])
  useEffect(() => {
    setModels([])
    if (ready) void window.api.assistant.models(mode).then(setModels).catch(() => {})
  }, [ready, mode])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [s.entries])

  const send = () => {
    if (!input.trim() || s.busy || !model) return
    const text = input
    setInput('')
    void ask(text, mode, model, app.settings?.assistant?.web ?? true, async (t) => window.confirm(`${translate('Помощник хочет выполнить действие в игре:')}\n\n${t}\n\n${translate('Разрешить?')}`))
  }
  const limitHit = s.entries[s.entries.length - 1]?.role === 'error' && /Лимит плана ChatGPT/.test(s.entries[s.entries.length - 1].text)

  return (
    <aside className="assistant-dock" aria-label="Помощник">
      <div className="assistant-head">
        <b>Помощник</b>
        {ready && <span className="muted small">{mode === 'chatgpt' ? translate('план ChatGPT') : translate('ключ API')}</span>}
        <span className="grow" />
        {s.tokens > 0 && <span className="muted small" title="Токены OpenAI в этом разговоре">{`${fmtNum(s.tokens)} ток.`}</span>}
        <button className="ghost small" title="Настройки помощника" onClick={() => setSetup(!setup)}>
          ⚙
        </button>
        <button className="ghost small" title="Новый разговор" onClick={clearChat} disabled={s.busy}>
          ⟲
        </button>
        <button className="ghost small" title="Закрыть (Ctrl+J)" onClick={onClose}>
          ✕
        </button>
      </div>

      {account && (setup || !ready) && <Setup account={account} mode={mode} models={models} model={model} onChange={reload} onDone={() => setSetup(false)} />}

      <div className="assistant-log" ref={log}>
        {!s.entries.length && ready && (
          <div className="assistant-hello muted">
            <p>Спросите что-нибудь — помощник берёт данные из Canopus и считает фиты движком приложения. Например:</p>
            {['Посчитай мой открытый фит и скажи, что улучшить', 'Собери Gila для абиссов T3 до 400M, чтобы я мог на ней летать', 'Сколько я заработал на рынке за месяц?', 'Безопасен ли маршрут до Jita сейчас?'].map((q) => (
              <button key={q} className="chip-btn" onClick={() => setInput(translate(q))}>
                {q}
              </button>
            ))}
          </div>
        )}
        {s.entries.map((e, i) => (
          <Entry key={i} e={e} onOpenFit={async (eft) => openFit((await fromEft(eft)).fit)} />
        ))}
        {limitHit && (
          <a className="button-link" href={MANAGE_USAGE}>
            Управлять лимитом
          </a>
        )}
        {s.busy && <div className="assistant-thinking muted small">Думаю…</div>}
        {kb?.updating && !kb.articles.uni && <div className="muted small">{knowledgeProgress(kb)}</div>}
      </div>

      <div className="assistant-input">
        <textarea
          value={input}
          placeholder={ready ? translate('Вопрос… (Enter — отправить, Shift+Enter — новая строка)') : translate('Сначала войдите через ChatGPT или добавьте ключ')}
          disabled={!ready}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={3}
        />
        <button onClick={send} disabled={!ready || s.busy || !input.trim() || !model}>
          Отправить
        </button>
      </div>
    </aside>
  )
}

function Setup({
  account,
  mode,
  models,
  model,
  onChange,
  onDone
}: {
  account: AssistantAccount
  mode: AssistantAuth
  models: string[]
  model: string
  onChange: () => void
  onDone: () => void
}) {
  const { updateSettings, settings } = useApp()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'chatgpt' | 'key' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setMode = (auth: AssistantAuth) => void updateSettings({ assistant: { model: settings?.assistant?.model ?? '', web: settings?.assistant?.web ?? true, auth } })
  const run = (what: 'chatgpt' | 'key', p: Promise<unknown>, then?: () => void) => {
    setBusy(what)
    setError(null)
    p.then(() => {
      onChange()
      then?.()
    })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null))
  }
  const gpt = account.chatgpt
  return (
    <div className="assistant-setup">
      <div className="assistant-option">
        <label className="check">
          <input type="radio" checked={mode === 'chatgpt'} onChange={() => setMode('chatgpt')} />
          <b>План ChatGPT</b>
          <span className="muted small">Plus или Pro, без отдельной оплаты</span>
        </label>
        {gpt ? (
          <>
            <div className="small">
              {gpt.plan ? '✔ ' : ''}
              <span translate="no">{gpt.email ?? 'ChatGPT'}</span>
              {gpt.plan ? ` · ${translate('Используется план ChatGPT')}` : ''}
            </div>
            {!gpt.plan && <div className="bad small">При входе не разрешено использовать план. Войдите ещё раз и оставьте разрешение «использовать мой план ChatGPT».</div>}
            <div className="row">
              {!gpt.plan && (
                <button className="small" disabled={!!busy} onClick={() => run('chatgpt', window.api.assistant.chatgptLogin(), () => setMode('chatgpt'))}>
                  Войти ещё раз
                </button>
              )}
              <a className="button-link small" href={MANAGE_USAGE}>
                Управлять лимитом
              </a>
              <button className="ghost small" onClick={() => run('chatgpt', window.api.assistant.chatgptLogout())}>
                Выйти
              </button>
            </div>
          </>
        ) : busy === 'chatgpt' ? (
          <div className="row">
            <span className="small muted">Завершите вход в открывшемся браузере…</span>
            <button className="ghost small" onClick={() => void window.api.assistant.chatgptCancel()}>
              Отмена
            </button>
          </div>
        ) : (
          <button
            onClick={() =>
              run('chatgpt', window.api.assistant.chatgptLogin(), () => {
                setMode('chatgpt')
                onDone()
              })
            }
          >
            Войти через ChatGPT
          </button>
        )}
      </div>

      <div className="assistant-option">
        <label className="check">
          <input type="radio" checked={mode === 'apikey'} onChange={() => setMode('apikey')} />
          <b>Ключ OpenAI API</b>
          <span className="muted small">оплата по запросам на platform.openai.com</span>
        </label>
        {account.apiKey ? (
          <div className="row">
            <span className="small">✔ Ключ сохранён</span>
            <button className="ghost small danger" onClick={() => run('key', window.api.assistant.clearKey())}>
              Удалить ключ
            </button>
          </div>
        ) : (
          <div className="row">
            <input type="password" className="grow" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
            <button
              className="small"
              disabled={!key.trim() || !!busy}
              onClick={() =>
                run('key', window.api.assistant.setKey(key), () => {
                  setKey('')
                  setMode('apikey')
                })
              }
            >
              {busy === 'key' ? 'Проверяю…' : 'Сохранить'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="bad small">{error}</div>}

      <KnowledgeRow />

      <label className="check small">
        <input
          type="checkbox"
          checked={settings?.assistant?.web ?? true}
          onChange={(e) => void updateSettings({ assistant: { auth: mode, model: settings?.assistant?.model ?? '', web: e.target.checked } })}
        />
        Искать в интернете, если в Canopus нет нужных данных (патчи, гайды, новости)
      </label>

      {models.length > 0 && (
        <label className="row">
          <span className="small">Модель</span>
          <select className="grow" value={model} onChange={(e) => void updateSettings({ assistant: { auth: mode, web: settings?.assistant?.web ?? true, model: e.target.value } })}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="small muted">
        Вход и ключ хранятся зашифрованными на этом компьютере и отправляются только в OpenAI. OpenAI получает ваши вопросы и данные, которые помощник берёт из
        Canopus для ответа (фиты, навыки, цены, кошелёк, имущество). Токены EVE и пароли не передаются никогда.
      </p>
    </div>
  )
}

function useKnowledge(): KnowledgeStatus | null {
  const [kb, setKb] = useState<KnowledgeStatus | null>(null)
  useEffect(() => {
    void window.api.knowledge.status().then(setKb)
    return window.api.knowledge.onStatus(setKb)
  }, [])
  return kb
}

function knowledgeProgress(kb: KnowledgeStatus): string {
  const p = kb.progress
  if (!p) return translate('Обновляю базу знаний…')
  return p.source === 'ccp' ? translate('Загружаю новости и патчноуты CCP…') : `${translate('Загружаю EVE University wiki:')} ${p.done}${p.total ? ` / ~${p.total}` : ''}`
}

/** What the knowledge base holds and when it was refreshed, with a button to refresh now. */
function KnowledgeRow() {
  const kb = useKnowledge()
  if (!kb) return null
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(locale()) : '—')
  return (
    <div className="assistant-option">
      <b className="small">База знаний</b>
      <div className="small muted">
        {kb.articles.uni
          ? `EVE University wiki: ${fmtNum(kb.articles.uni)} ${translate('статей')} (${when(kb.updated.uni)}) · CCP: ${fmtNum(kb.articles.ccp)} (${when(kb.updated.ccp)}) · ${translate('заметки Canopus')}: ${kb.articles.notes}`
          : translate('Ещё не загружена: статьи EVE University wiki и патчноуты CCP скачиваются на этот компьютер (около 40 МБ) и обновляются раз в неделю.')}
      </div>
      <div className="row">
        {kb.updating ? (
          <span className="small">{knowledgeProgress(kb)}</span>
        ) : (
          <button className="small" onClick={() => void window.api.knowledge.update()}>
            {kb.articles.uni ? 'Обновить' : 'Загрузить'}
          </button>
        )}
      </div>
      <div className="small muted">
        Тексты EVE University wiki — CC BY-SA 4.0, <a href="https://wiki.eveuniversity.org">wiki.eveuniversity.org</a>; помощник ссылается на источники в ответах.
      </div>
    </div>
  )
}

function Entry({ e, onOpenFit }: { e: ChatEntry; onOpenFit: (eft: string) => void }) {
  if (e.role === 'user')
    return (
      <div className="assistant-msg user" translate="no">
        {e.text}
      </div>
    )
  if (e.role === 'error')
    return (
      <div className="assistant-msg error bad small" translate="no">
        {e.text}
      </div>
    )
  return (
    <div className="assistant-msg bot">
      {!!e.steps?.length && (
        <div className="assistant-steps">
          {e.steps.map((st) => (
            <details key={st.id} className="assistant-step">
              <summary className={st.result ? (st.result.startsWith('{"error"') ? 'bad' : '') : 'muted'}>
                {st.result ? '✓' : '…'} {translate(TOOL_LABELS[st.name] ?? st.name)}
              </summary>
              <pre>{st.args}</pre>
              {st.result && <pre>{st.result.length > 3000 ? st.result.slice(0, 3000) + '…' : st.result}</pre>}
            </details>
          ))}
        </div>
      )}
      {e.text && (
        <div translate="no">
          <Markdown text={e.text} onOpenFit={onOpenFit} />
        </div>
      )}
      {!!e.sources?.length && (
        <div className="assistant-sources small">
          <span className="muted">Источники:</span>
          {e.sources.map((src) => (
            <a key={src.url} href={src.url} title={src.url} translate="no">
              {src.title || new URL(src.url).hostname}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** Inline markdown: **bold**, *italic*, `code`. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    out.push(t.startsWith('**') ? <b key={m.index}>{t.slice(2, -2)}</b> : t.startsWith('`') ? <code key={m.index}>{t.slice(1, -1)}</code> : <i key={m.index}>{t.slice(1, -1)}</i>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** The subset of markdown the model writes: headings, lists, tables, code blocks (EFT fits get an "open" button). */
function Markdown({ text, onOpenFit }: { text: string; onOpenFit: (eft: string) => void }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++
      const code = body.join('\n')
      const isFit = /^\[[^\]]+,[^\]]*\]/.test(code.trim())
      blocks.push(
        <div key={i} className="assistant-code">
          <pre>{code}</pre>
          <div className="row">
            {isFit && (
              <button className="small" onClick={() => onOpenFit(code)}>
                Открыть в фитинге
              </button>
            )}
            <button className="ghost small" onClick={() => void navigator.clipboard.writeText(code)}>
              Копировать
            </button>
          </div>
        </div>
      )
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()))
        i++
      }
      blocks.push(
        <table key={i} className="table compact assistant-table">
          <tbody>
            {rows.map((r, k) => (
              <tr key={k}>{r.map((c, j) => (k === 0 ? <th key={j}>{inline(c)}</th> : <td key={j}>{inline(c)}</td>))}</tr>
            ))}
          </tbody>
        </table>
      )
      continue
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={i}>
          {items.map((t, k) => (
            <li key={k}>{inline(t)}</li>
          ))}
        </List>
      )
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) blocks.push(<div key={i} className="assistant-h">{inline(h[2])}</div>)
    else if (line.trim()) blocks.push(<p key={i}>{inline(line)}</p>)
    i++
  }
  return <Fragment>{blocks}</Fragment>
}
