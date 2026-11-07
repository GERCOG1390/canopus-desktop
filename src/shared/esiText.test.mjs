import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeEsiName } from './esiText.ts'

test('a ship name sent as a Python literal reads as text', () => {
  assert.equal(decodeEsiName(String.raw`u'Crow\xa0— Alexandr Gercog'`), 'Crow — Alexandr Gercog')
  assert.equal(decodeEsiName(String.raw`u'It\'s mine \U0001F680'`), "It's mine 🚀")
})

test('ordinary names stay as they are', () => {
  assert.equal(decodeEsiName('Drake'), 'Drake')
  assert.equal(decodeEsiName("it's u'mine'"), "it's u'mine'")
  assert.equal(decodeEsiName("u'"), "u'")
  assert.equal(decodeEsiName(''), '')
})
