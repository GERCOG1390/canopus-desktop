// The assistant panel: a chat docked on the right of the main window, next to whatever section is
// open, so the fits and pages the assistant opens show up beside the conversation.

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useApp } from '../AppContext'
import { useCharacter } from '../CharacterContext'
import { translate } from '../i18n'
import { ask, assistantState, clearChat, setAssistantContext, subscribeAssistant, type ChatEntry } from '../lib/assistant'
import { TOOL_LABELS } from '../lib/assistantTools'
import { fromEft, useFitting } from '../lib/fitting'
import { fmtNum } from '../lib/format'

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const char = useCharacter()
  const { fit, openFit } = useFitting()
  const s = useSyncExternalStore(subscribeAssistant, assistantState)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [setup, setSetup] = useState(false)
  const [input, setInput] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const model = app.settings?.assistant?.model || models[0] || ''

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

  useEffect(() => {
    void window.api.assistant.hasKey().then((k) => {
      setHasKey(k)
      if (k) void window.api.assistant.models().then(setModels).catch(() => {})
    })
  }, [])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [s.entries])

  const send = () => {
    if (!input.trim() || s.busy || !model) return
    const text = input
    setInput('')
    void ask(text, model, async (t) => window.confirm(`${translate('Помощник хочет выполнить действие в игре:')}\n\n${t}\n\n${translate('Разрешить?')}`))
  }

  return (
    <aside className="assistant-dock" aria-label="Помощник">
      <div className="assistant-head">
        <b>Помощник</b>
        {model && <span className="muted small" translate="no">{model}</span>}
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

      {(setup || hasKey === false) && (
        <Setup
          hasKey={!!hasKey}
          models={models}
          model={model}
          onKey={(list) => {
            setHasKey(true)
            setModels(list)
            setSetup(false)
          }}
          onClear={() => {
            setHasKey(false)
            setModels([])
          }}
        />
      )}

      <div className="assistant-log" ref={log}>
        {!s.entries.length && hasKey && (
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
        {s.busy && <div className="assistant-thinking muted small">Думаю…</div>}
      </div>

      <div className="assistant-input">
        <textarea
          value={input}
          placeholder={hasKey ? translate('Вопрос… (Enter — отправить, Shift+Enter — новая строка)') : translate('Сначала добавьте ключ OpenAI')}
          disabled={!hasKey}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={3}
        />
        <button onClick={send} disabled={!hasKey || s.busy || !input.trim()}>
          Отправить
        </button>
      </div>
    </aside>
  )
}

function Setup({ hasKey, models, model, onKey, onClear }: { hasKey: boolean; models: string[]; model: string; onKey: (models: string[]) => void; onClear: () => void }) {
  const { updateSettings, settings } = useApp()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="assistant-setup">
      {!hasKey ? (
        <>
          <p className="small">
            Помощник работает через OpenAI API с вашим ключом: запросы оплачиваются на вашем аккаунте OpenAI (обычно доли цента за вопрос). Ключ хранится
            зашифрованным на этом компьютере и отправляется только на api.openai.com.
          </p>
          <p className="small muted">
            Ключ создаётся на <a href="https://platform.openai.com/api-keys">platform.openai.com/api-keys</a>. OpenAI получает ваши вопросы и данные, которые
            помощник берёт из Canopus для ответа (фиты, навыки, цены, кошелёк, имущество). Токены EVE и пароли не передаются никогда.
          </p>
          <div className="row">
            <input type="password" className="grow" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
            <button
              disabled={!key.trim() || busy}
              onClick={() => {
                setBusy(true)
                setError(null)
                window.api.assistant
                  .setKey(key)
                  .then((list) => {
                    setKey('')
                    onKey(list)
                  })
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Проверяю…' : 'Сохранить'}
            </button>
          </div>
          {error && <div className="bad small">{error}</div>}
        </>
      ) : (
        <>
          <label className="row">
            <span className="small">Модель</span>
            <select className="grow" value={model} onChange={(e) => void updateSettings({ assistant: { ...settings?.assistant, model: e.target.value } })}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">Список — модели, доступные вашему ключу. Более крупные модели точнее, но дороже и медленнее.</p>
          <button
            className="ghost small danger"
            onClick={() =>
              void window.api.assistant.clearKey().then(() => {
                onClear()
              })
            }
          >
            Удалить ключ
          </button>
        </>
      )}
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
