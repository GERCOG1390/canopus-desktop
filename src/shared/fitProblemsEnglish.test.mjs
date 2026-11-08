import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { EXACT, PATTERNS, TOKENS } from '../renderer/src/i18n/dict.ts'

// The English UI translates on render with the dictionary; this is its lookup without the cache.
const CYR = /[А-Яа-яЁё]/
function tr(text) {
  const core = text.trim()
  if (EXACT[core] !== undefined) return EXACT[core]
  for (const [re, rep] of PATTERNS) {
    const m = re.exec(core)
    if (m) return rep.replace(/\$(\d)/g, (_, i) => tr(m[Number(i)] ?? ''))
  }
  let out = core
  for (const [re, rep] of TOKENS) out = out.replace(re, rep)
  return out
}

// Every problem the engine reports about a fit, with sample numbers in place of the variables.
const src = readFileSync(new URL('../main/dogma/stats.ts', import.meta.url), 'utf8')
const problems = [...src.matchAll(/(?:problems|p)\.push\((['`])(.+?)\1\)/g)]
  .map((m) => m[2])
  .filter((s) => CYR.test(s))
  .map((s) => s.replace(/\$\{slot\}/g, 'hi').replace(/\$\{[^}]+\}/g, '3'))

test('the engine reports fit problems: there are some to check', () => {
  assert.ok(problems.length >= 10, `found ${problems.length}`)
})

test('every fit problem reads in English, also with the module name in front', () => {
  for (const p of problems) {
    assert.ok(!CYR.test(tr(p)), `untranslated: ${p} → ${tr(p)}`)
    if (/^(Нельзя|Неподходящий|Можно установить|Активным)/.test(p)) assert.ok(!CYR.test(tr(`Warp Disruptor II: ${p}`)), `untranslated with a name: ${p}`)
  }
})

test('the implant bonus on an attribute and the read-only mark read in English', () => {
  assert.equal(tr('(+3 импланты)'), '(+3 implants)')
  assert.equal(tr(' · только чтение'), '· read only')
})
