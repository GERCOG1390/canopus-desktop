// Development counterpart of ./jsx-runtime.ts (used by `npm run dev`).

import * as runtime from 'react/jsx-dev-runtime'
import { translateProps } from './jsx-runtime'

export * from 'react/jsx-dev-runtime'

export function jsxDEV(type: never, props: Record<string, unknown>, key: string | undefined, isStatic: boolean, source: unknown, self: unknown) {
  return (runtime.jsxDEV as (...args: unknown[]) => unknown)(type, translateProps(type, props), key, isStatic, source, self)
}
