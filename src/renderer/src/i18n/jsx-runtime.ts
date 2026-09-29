// JSX runtime wrapper: translates string children and text attributes before React sees them.
// Wired in via `jsxImportSource: '@i18n'` (see electron.vite.config.ts and tsconfig.web.json).

import * as runtime from 'react/jsx-runtime'
import { IS_MAC, translate, uiLang } from './index'

export * from 'react/jsx-runtime'

const TEXT_PROPS = ['title', 'placeholder', 'alt', 'aria-label'] as const

type Props = Record<string, unknown> & { children?: unknown }

export function translateProps(type: unknown, props: Props): Props {
  if ((uiLang() === 'ru' && !IS_MAC) || !props) return props
  // Player-written text (chat messages, names) opts out with the standard HTML attribute.
  if (props.translate === 'no') return props
  let out = props
  const set = (key: string, value: unknown) => {
    if (out === props) out = { ...props }
    out[key] = value
  }
  const c = props.children
  if (typeof c === 'string') {
    const t = translate(c)
    if (t !== c) set('children', t)
  } else if (Array.isArray(c) && c.some((x) => typeof x === 'string')) {
    set(
      'children',
      c.map((x) => (typeof x === 'string' ? translate(x) : x))
    )
  }
  if (typeof type === 'string') {
    for (const key of TEXT_PROPS) {
      const v = props[key]
      if (typeof v === 'string') {
        const t = translate(v)
        if (t !== v) set(key, t)
      }
    }
  }
  return out
}

export function jsx(type: never, props: Props, key?: string) {
  return runtime.jsx(type, translateProps(type, props) as never, key)
}

export function jsxs(type: never, props: Props, key?: string) {
  return runtime.jsxs(type, translateProps(type, props) as never, key)
}
