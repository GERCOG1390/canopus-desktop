// EVE mail: labels, inbox, reading (marks read), reply, delete, compose and send.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import { GameButton } from '../components/GameButton'
import { Card, Empty, ErrorBox, Loading, RequireLogin } from '../components/ui'
import { esi, imageUrl, resolveIds, resolveNames } from '../lib/esi'
import { hasScope, openNewMailInGame, SCOPE } from '../lib/gameActions'
import { fmtDate } from '../lib/format'
import { useAsync } from '../lib/useAsync'

interface Label {
  label_id: number
  name?: string
  unread_count?: number
}
interface Header {
  mail_id: number
  from?: number
  subject?: string
  timestamp?: string
  is_read?: boolean
  labels?: number[]
  recipients?: { recipient_id: number; recipient_type: string }[]
}
interface Mail {
  body?: string
  from?: number
  subject?: string
  timestamp?: string
  recipients?: { recipient_id: number; recipient_type: string }[]
}

/** EVE mail bodies are a small HTML dialect (<br>, <font>, showinfo links): shown as plain text. */
function mailText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default function MailPage() {
  const { active } = useApp()
  if (!active) return <RequireLogin what="почту" />
  if (!hasScope(active, SCOPE.readMail))
    return (
      <div className="page">
        <Empty>Чтобы читать и отправлять почту, нажмите «Настройки → Разрешить действия в игре» и войдите заново.</Empty>
      </div>
    )
  return <Mailbox id={active.id} />
}

function Mailbox({ id }: { id: number }) {
  const { active } = useApp()
  const [label, setLabel] = useState<number | null>(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string } | null>(null)
  const [version, setVersion] = useState(0)
  const [more, setMore] = useState<Header[]>([])
  const reload = () => {
    setVersion((v) => v + 1)
    setMore([])
  }

  const labels = useAsync(() => esi<{ labels: Label[]; total_unread_count?: number }>(`/characters/${id}/mail/labels/`, { characterId: id, fresh: version > 0 }), [id, version])
  const page = useAsync(async () => {
    const list = await esi<Header[]>(`/characters/${id}/mail/${label ? `?labels=${label}` : ''}`, { characterId: id, fresh: version > 0 })
    return list
  }, [id, label, version])
  const headers = useMemo(() => [...(page.data ?? []), ...more], [page.data, more])
  const names = useAsync(async () => resolveNames([...new Set(headers.flatMap((h) => [h.from ?? 0, ...(h.recipients?.map((r) => r.recipient_id) ?? [])]))].filter(Boolean)).catch(() => new Map<number, string>()), [headers.length, headers[0]?.mail_id])

  async function loadMore() {
    const last = headers.at(-1)?.mail_id
    if (!last) return
    const list = await esi<Header[]>(`/characters/${id}/mail/?last_mail_id=${last}${label ? `&labels=${label}` : ''}`, { characterId: id })
    setMore((m) => [...m, ...list])
  }

  useEffect(() => setOpenId(null), [label])
  const nameOf = (x?: number) => (x ? (names.data?.get(x) ?? String(x)) : '—')

  return (
    <div className="page mail-page">
      <div className="mail-layout">
        <aside className="mail-labels">
          <button onClick={() => setCompose({ to: '', subject: '', body: '' })}>Написать</button>
          {labels.loading ? (
            <Loading />
          ) : (
            (labels.data?.labels ?? []).map((l) => (
              <button key={l.label_id} className={`ghost mail-label ${label === l.label_id ? 'active' : ''}`} onClick={() => setLabel(l.label_id)}>
                <span translate="no">{l.name ?? `#${l.label_id}`}</span>
                {!!l.unread_count && <b className="mail-unread">{l.unread_count}</b>}
              </button>
            ))
          )}
          <button className={`ghost mail-label ${label === null ? 'active' : ''}`} onClick={() => setLabel(null)}>
            Все письма
          </button>
          <button className="ghost small" onClick={reload}>
            Обновить
          </button>
        </aside>
        <div className="mail-main">
          {compose ? (
            <Compose
              draft={compose}
              onClose={() => setCompose(null)}
              onSent={() => {
                setCompose(null)
                reload()
              }}
              fromId={id}
            />
          ) : openId ? (
            <MailView
              id={id}
              mailId={openId}
              nameOf={nameOf}
              onBack={() => setOpenId(null)}
              onReply={(m) =>
                setCompose({
                  to: nameOf(m.from),
                  subject: m.subject?.startsWith('Re:') ? m.subject : `Re: ${m.subject ?? ''}`,
                  body: `\n\n--- ${nameOf(m.from)}, ${m.timestamp ? fmtDate(m.timestamp) : ''} ---\n${mailText(m.body ?? '')}`
                })
              }
              onChanged={reload}
            />
          ) : page.loading ? (
            <Loading />
          ) : page.error ? (
            <ErrorBox error={page.error} />
          ) : !headers.length ? (
            <Empty>Писем нет.</Empty>
          ) : (
            <Card>
              <table className="table compact mail-list">
                <tbody>
                  {headers.map((h) => (
                    <tr key={h.mail_id} className={`clickable ${h.is_read ? '' : 'mail-new'}`} onClick={() => setOpenId(h.mail_id)}>
                      <td className="nowrap">
                        <span className="with-icon">
                          {h.from && <img src={imageUrl.portrait(h.from, 32)} width={20} height={20} alt="" className="portrait-sm" />}
                          <span translate="no">{nameOf(h.from)}</span>
                        </span>
                      </td>
                      <td translate="no">{h.subject || '—'}</td>
                      <td className="num muted small nowrap">{h.timestamp ? fmtDate(h.timestamp) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {headers.length >= 50 && (
                <button className="ghost" onClick={() => void loadMore()}>
                  Ещё письма
                </button>
              )}
            </Card>
          )}
        </div>
      </div>
      {!active?.scopes.includes(SCOPE.organizeMail) && <p className="muted small">Отметка «прочитано» и удаление требуют разрешения esi-mail.organize_mail.v1.</p>}
    </div>
  )
}

function MailView({
  id,
  mailId,
  nameOf,
  onBack,
  onReply,
  onChanged
}: {
  id: number
  mailId: number
  nameOf: (x?: number) => string
  onBack: () => void
  onReply: (m: Mail) => void
  onChanged: () => void
}) {
  const { active } = useApp()
  const mail = useAsync(() => esi<Mail>(`/characters/${id}/mail/${mailId}/`, { characterId: id }), [id, mailId])
  // Opening a mail marks it read, as in the game.
  useEffect(() => {
    if (!mail.data || !active || !hasScope(active, SCOPE.organizeMail)) return
    esi(`/characters/${id}/mail/${mailId}/`, { method: 'PUT', characterId: id, body: { read: true } }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail.data])
  if (mail.loading) return <Loading />
  if (!mail.data) return <ErrorBox error={mail.error} />
  const m = mail.data
  return (
    <Card
      title={
        <span translate="no">{m.subject || '—'}</span>
      }
      actions={
        <>
          <button className="ghost" onClick={onBack}>
            ← К списку
          </button>
          <button onClick={() => onReply(m)}>Ответить</button>
          <GameButton
            scope={SCOPE.organizeMail}
            className="ghost danger"
            confirm="Удалить это письмо?"
            action={async () => {
              await esi(`/characters/${id}/mail/${mailId}/`, { method: 'DELETE', characterId: id })
              onBack()
              onChanged()
            }}
          >
            Удалить
          </GameButton>
        </>
      }
    >
      <div className="muted small" translate="no">
        {`${nameOf(m.from)} → ${(m.recipients ?? []).map((r) => nameOf(r.recipient_id)).join(', ')} · ${m.timestamp ? fmtDate(m.timestamp) : ''}`}
      </div>
      <div className="mail-body" translate="no">
        {mailText(m.body ?? '')}
      </div>
    </Card>
  )
}

function Compose({ draft, onClose, onSent, fromId }: { draft: { to: string; subject: string; body: string }; onClose: () => void; onSent: () => void; fromId: number }) {
  const [to, setTo] = useState(draft.to)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [error, setError] = useState<string | null>(null)

  async function recipients() {
    const list = to.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
    const r = await resolveIds(list)
    const out = [
      ...(r.characters ?? []).map((x) => ({ recipient_id: x.id, recipient_type: 'character' })),
      ...(r.corporations ?? []).map((x) => ({ recipient_id: x.id, recipient_type: 'corporation' })),
      ...(r.alliances ?? []).map((x) => ({ recipient_id: x.id, recipient_type: 'alliance' }))
    ]
    const found = new Set([...(r.characters ?? []), ...(r.corporations ?? []), ...(r.alliances ?? [])].map((x) => x.name.toLowerCase()))
    const missing = list.filter((n) => !found.has(n.toLowerCase()))
    if (missing.length) throw new Error(`Не найдены: ${missing.join(', ')}`)
    if (!out.length) throw new Error('Укажите получателя')
    return out
  }

  return (
    <Card title="Новое письмо" actions={<button className="ghost" onClick={onClose}>Отмена</button>}>
      <label>
        Кому (имена через запятую: персонажи, корпорации, альянсы)
        <input value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label>
        Тема
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label>
        Текст
        <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="row">
        <GameButton
          scope={SCOPE.sendMail}
          className=""
          done="отправлено"
          action={async () => {
            setError(null)
            try {
              await esi(`/characters/${fromId}/mail/`, {
                method: 'POST',
                characterId: fromId,
                body: { recipients: await recipients(), subject: subject.slice(0, 1000), body: escapeHtml(body).replace(/\n/g, '<br>'), approved_cost: 0 }
              })
              onSent()
            } catch (e) {
              setError((e as Error).message)
              throw e
            }
          }}
        >
          Отправить
        </GameButton>
        <GameButton
          scope={SCOPE.openWindow}
          title="Открыть это письмо в клиенте игры — отправите там"
          action={async (who) => openNewMailInGame(who, { recipients: (await recipients()).map((r) => r.recipient_id), subject, body })}
        >
          Открыть в игре
        </GameButton>
      </div>
      <ErrorBox error={error} />
    </Card>
  )
}
