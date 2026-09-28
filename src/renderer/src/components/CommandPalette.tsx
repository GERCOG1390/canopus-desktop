// Ctrl+K: jump to a section, run a command or open any item's Show Info from one field.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp, useLang, type PageId } from '../AppContext'
import { translate } from '../i18n'
import { THEMES } from '../lib/appearance'
import { searchTypesSde } from '../lib/sde'
import { Glyph, type GlyphName } from './Glyph'
import { useInfo } from './InfoContext'
import { TypeLink } from './TypeLink'

export interface NavPage {
  id: PageId
  label: string
  group: string
  icon: GlyphName
}

interface Entry {
  key: string
  section: string
  label: ReactNode
  /** Text matched against the query */
  text: string
  icon?: GlyphName
  hint?: string
  run: () => void
}

export function CommandPalette({ pages, open, onClose }: { pages: NavPage[]; open: boolean; onClose: () => void }) {
  const { navigate, settings, updateSettings, login } = useApp()
  const { open: openInfo } = useInfo()
  const lang = useLang()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<{ id: number; name: string; alt?: string }[]>([])
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setItems([])
    setCursor(0)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // Items from the SDE, a moment after typing stops.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setItems([])
    const t = setTimeout(() => {
      void searchTypesSde(q, lang)
        .then((r) => setItems(r.slice(0, 8)))
        .catch(() => setItems([]))
    }, 180)
    return () => clearTimeout(t)
  }, [query, lang])

  const commands = useMemo<Entry[]>(() => {
    if (!settings) return []
    const done = (f: () => unknown) => () => {
      void f()
      onClose()
    }
    const list: Entry[] = [
      { key: 'login', section: 'Команды', label: 'Добавить персонажа (EVE SSO)', text: 'войти персонаж sso login', icon: 'user', run: done(() => login()) },
      {
        key: 'overlay',
        section: 'Команды',
        label: settings.intel.overlay.enabled ? 'Скрыть оверлей разведки' : 'Показать оверлей разведки',
        text: 'оверлей overlay разведка',
        icon: 'intel',
        hint: 'Ctrl+Shift+L',
        run: done(() => window.api.intel.setOverlay({ enabled: !settings.intel.overlay.enabled }))
      },
      {
        key: 'lang',
        section: 'Команды',
        label: settings.lang === 'en' ? 'Русский интерфейс' : 'English interface',
        text: 'язык language english русский',
        icon: 'globe',
        run: done(() => updateSettings({ lang: settings.lang === 'en' ? 'ru' : 'en' }))
      },
      {
        key: 'density',
        section: 'Команды',
        label: settings.density === 'compact' ? 'Плотность: удобно' : 'Плотность: компактно',
        text: 'плотность density компактно удобно',
        icon: 'rows',
        run: done(() => updateSettings({ density: settings.density === 'compact' ? 'comfortable' : 'compact' }))
      },
      {
        key: 'update',
        section: 'Команды',
        label: 'Проверить обновления',
        text: 'обновления update версия',
        icon: 'update',
        run: done(() => {
          navigate('settings')
          return window.api.update.check()
        })
      },
      ...THEMES.filter((t) => t.id !== settings.theme).map((t) => ({
        key: `theme-${t.id}`,
        section: 'Команды',
        label: `Тема: ${translate(t.label)}`,
        text: `тема theme ${t.label} ${t.id}`,
        icon: 'palette' as GlyphName,
        run: done(() => updateSettings({ theme: t.id }))
      }))
    ]
    return list
  }, [settings, login, updateSettings, navigate, onClose])

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase()
    const match = (e: Entry) => !q || e.text.toLowerCase().includes(q)
    const pageEntries: Entry[] = pages.map((p) => ({
      key: `page-${p.id}`,
      section: 'Разделы',
      label: translate(p.label),
      text: `${p.label} ${translate(p.label)} ${p.group} ${p.id}`,
      icon: p.icon,
      hint: translate(p.group),
      run: () => {
        navigate(p.id)
        onClose()
      }
    }))
    const itemEntries: Entry[] = items.map((t) => ({
      key: `item-${t.id}`,
      section: 'Предметы',
      label: (
        <>
          <TypeLink id={t.id} />
          {t.alt && <span className="muted small"> {t.alt}</span>}
        </>
      ),
      text: t.name,
      run: () => {
        openInfo(t.id)
        onClose()
      }
    }))
    return [...pageEntries.filter(match), ...itemEntries, ...commands.filter(match)]
  }, [query, pages, items, commands, navigate, openInfo, onClose])

  useEffect(() => setCursor(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(entries.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      entries[cursor]?.run()
    }
  }

  let lastSection = ''
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Поиск и команды" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <label className="palette-input">
          <Glyph name="search" size={18} />
          <input ref={inputRef} value={query} placeholder="Раздел, предмет или команда…" onChange={(e) => setQuery(e.target.value)} aria-label="Поиск и команды" />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-list" ref={listRef} role="listbox">
          {entries.map((e, i) => {
            const head = e.section !== lastSection
            lastSection = e.section
            return (
              <li key={e.key} role="presentation">
                {head && <div className="palette-section">{e.section}</div>}
                <div
                  role="option"
                  aria-selected={i === cursor}
                  className={i === cursor ? 'palette-item active' : 'palette-item'}
                  onMouseMove={() => setCursor(i)}
                  onClick={e.run}
                >
                  {e.icon && <Glyph name={e.icon} size={16} className="palette-icon" />}
                  <span className="grow">{e.label}</span>
                  {e.hint && <span className="muted small">{e.hint}</span>}
                </div>
              </li>
            )
          })}
          {entries.length === 0 && <li className="palette-empty muted">Ничего не найдено</li>}
        </ul>
        <div className="palette-foot muted small">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> выбор
          </span>
          <span>
            <kbd>Enter</kbd> открыть
          </span>
        </div>
      </div>
    </div>
  )
}
