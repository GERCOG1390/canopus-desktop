import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MARK_CSS, markSvg } from './brandMark.ts'

test('two marks on one page share no ids, and each refers only to its own', () => {
  const ids = (svg) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
  const refs = (svg) => [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
  const a = markSvg({ p: 'hd' })
  const b = markSvg({ p: 'cta' })
  assert.equal(ids(a).filter((x) => ids(b).includes(x)).length, 0)
  for (const r of refs(a)) assert.ok(ids(a).includes(r), r)
})

test('the motion stops when the system asks for reduced motion', () => {
  assert.match(MARK_CSS, /prefers-reduced-motion: reduce[\s\S]*animation: none/)
  assert.match(markSvg({ dur: 14 }), /dur="14s"/)
})
