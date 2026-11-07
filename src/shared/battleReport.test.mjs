import assert from 'node:assert/strict'
import { test } from 'node:test'
import { battleStamp, parseBattleQuery, summarizeBattle } from './battleReport.ts'

// Trimmed from the real related page for RF-K9W, 2026-11-06 20:00.
const pilot = (o) => ({ shipTypeID: 1, characterID: 1, groupID: 900, groupName: 'Battleship', characterName: 'P', corporationName: 'C', ...o })
const at = (ms, value) => ({ dttm: { $date: { $numberLong: String(ms) } }, zkb: { totalValue: value } })
const related = {
  systemID: 30004724,
  systemName: 'RF-K9W',
  regionName: 'Delve',
  summary: {
    teamA: {
      list: [
        pilot({ characterID: 10, shipTypeID: 4302, groupID: 1201, groupName: 'Attack Battlecruiser', isVictim: true, killID: 101, characterName: 'Miss Sparkle' }),
        pilot({ characterID: 11, shipTypeID: 11989, groupID: 893, groupName: 'Electronic Attack Ship', isVictim: true, killID: 102 }),
        pilot({ characterID: 12, shipTypeID: 4302, groupID: 1201, groupName: 'Attack Battlecruiser' }),
        pilot({ characterID: 13, shipTypeID: 4302, groupID: 1201, groupName: 'Attack Battlecruiser' }),
        // Flew and died: the same ship once.
        pilot({ characterID: 14, shipTypeID: 11989, groupID: 893, groupName: 'Electronic Attack Ship' })
      ],
      kills: { 101: at(1793997236000, 142112535.52), 102: at(1793997300000, 56115578.48) },
      totals: { total_price: 198228114, total_dropped: 65635627.22, totalShips: 2, pilotCount: 5 },
      entities: { 99015272: { name: 'Escalate.', type: 'alliance' } }
    },
    teamB: {
      list: [
        pilot({ characterID: 20, shipTypeID: 73790, groupID: 485, groupName: 'Dreadnought', isVictim: true, killID: 201, characterName: 'White Nova' }),
        pilot({ characterID: 20, shipTypeID: 670, groupID: 29, groupName: 'Capsule', isVictim: true, killID: 202, characterName: 'White Nova' })
      ],
      kills: { 201: at(1793997400000, 5493172210.98), 202: at(1793997395000, 10000) },
      totals: { total_price: 5493182210.98, total_dropped: 500444077.78, totalShips: 2, pilotCount: 1 },
      entities: { 99013537: { name: 'Insidious.', type: 'alliance' } }
    }
  }
}

test('the two sides: lost, dropped, pilots', () => {
  const b = summarizeBattle(related)
  const [a, z] = b.sides
  assert.equal(a.iskLost, 198228114)
  assert.equal(a.iskDropped, 65635627.22)
  assert.equal(a.shipsLost, 2)
  assert.equal(a.pilots, 5)
  assert.deepEqual(a.entities, [{ id: 99015272, name: 'Escalate.', type: 'alliance' }])
  assert.equal(z.pilots, 1)
  assert.equal(b.iskDestroyed, 5691410324.98)
})

test('efficiency is the enemy share of everything destroyed, and the sides sum to one', () => {
  const [a, z] = summarizeBattle(related).sides
  assert.ok(Math.abs(a.efficiency - 5493182210.98 / 5691410324.98) < 1e-12)
  assert.ok(Math.abs(a.efficiency + z.efficiency - 1) < 1e-12)
})

test('losses: dearest first, with the value of their kill; pods are losses too', () => {
  const [a, z] = summarizeBattle(related).sides
  assert.deepEqual(a.losses.map((l) => l.killId), [101, 102])
  assert.equal(a.losses[0].value, 142112535.52)
  assert.equal(a.losses[0].pilot, 'Miss Sparkle')
  assert.deepEqual(z.losses.map((l) => l.killId), [201, 202])
})

test('fielded ships by class: pods aside, a lost ship counted once as fielded and lost', () => {
  const [a, z] = summarizeBattle(related).sides
  assert.deepEqual(a.fielded, [
    { groupId: 1201, group: 'Attack Battlecruiser', count: 3, lost: 1 },
    { groupId: 893, group: 'Electronic Attack Ship', count: 2, lost: 1 }
  ])
  assert.deepEqual(z.fielded, [{ groupId: 485, group: 'Dreadnought', count: 1, lost: 1 }])
})

test('a pilot who fought and lost the same ship is one ship', () => {
  const r = structuredClone(related)
  r.summary.teamA.list.push(pilot({ characterID: 10, shipTypeID: 4302, groupID: 1201, groupName: 'Attack Battlecruiser' }))
  const [a] = summarizeBattle(r).sides
  assert.deepEqual(a.fielded[0], { groupId: 1201, group: 'Attack Battlecruiser', count: 3, lost: 1 })
})

test('first and last kill across both sides', () => {
  const b = summarizeBattle(related)
  assert.equal(b.first, 1793997236000)
  assert.equal(b.last, 1793997400000)
})

test('an empty side: zKillboard sends a list for an empty map', () => {
  const r = structuredClone(related)
  r.summary.teamB = { list: [], kills: [], totals: {}, entities: [] }
  const b = summarizeBattle(r)
  assert.deepEqual(b.sides[1].entities, [])
  assert.equal(b.sides[1].iskLost, 0)
  assert.equal(b.sides[0].efficiency, 0)
  assert.equal(b.sides[1].efficiency, 1)
})

test('no kills at all', () => {
  const r = { systemID: 1, systemName: 'X', summary: { teamA: { list: [], kills: [], totals: {}, entities: [] }, teamB: { list: [], kills: [], totals: {}, entities: [] } } }
  const b = summarizeBattle(r)
  assert.equal(b.first, null)
  assert.equal(b.sides[0].efficiency, 0)
})

test('links and numbers', () => {
  assert.deepEqual(parseBattleQuery('https://zkillboard.com/related/30004724/202611062000/'), { systemId: 30004724, stamp: '202611062000' })
  assert.deepEqual(parseBattleQuery(' https://zkillboard.com/kill/139721301/ '), { killId: 139721301 })
  assert.deepEqual(parseBattleQuery('139721301'), { killId: 139721301 })
  assert.equal(parseBattleQuery('Jita'), null)
  assert.equal(parseBattleQuery('12'), null)
})

test('the related time is the hour of the kill', () => {
  assert.equal(battleStamp('2026-11-06T20:35:19Z'), '202611062000')
  assert.equal(battleStamp('2026-11-06 20:35'), '202611062000')
  assert.equal(battleStamp('nope'), null)
})
