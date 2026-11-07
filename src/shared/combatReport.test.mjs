import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFights, findings, parseCombatLine } from './combatReport.ts'

// Real lines, from the tests of the open eve-log-parser crate (a format fact).
const OUT = "[ 2024.07.02 20:31:28 ] (combat) <color=0xff00ffff><b>200</b> <color=0x77ffffff><font size=10>to</font> <b><color=0xffffffff>Hornet EC-300[-15.0](Hornet EC-300)</b><font size=10><color=0x77ffffff> - Draclira's Modified Tachyon Beam Laser - Penetrates"
const IN = "[ 2024.06.25 15:20:01 ] (combat) <color=0xffcc0000><b>375</b> <color=0x77ffffff><font size=10>from</font> <b><color=0xffffffff>Tek'wka Rokym[WH.SQ](Paladin)</b><font size=10><color=0x77ffffff> - Imperial Navy Large EMP Smartbomb - Hits"
const REP = '[ 2024.07.02 19:13:23 ] (combat) <color=0xffccff66><b>772</b><color=0x77ffffff><font size=10> remote shield boosted by </font><b><color=0xffffffff><font size=14><color=0xFFFFFFFF> <b>Osprey</b></color></font><color=0xFFB3B3B3> [Drentu]<color=0xFFFFFFFF><b> -</color> </b><color=0x77ffffff><font size=10> - Medium Ancillary Remote Shield Booster</font>'

test('real damage lines', () => {
  assert.deepEqual(parseCombatLine(OUT), {
    t: Date.UTC(2024, 6, 2, 20, 31, 28),
    kind: 'out',
    amount: 200,
    who: 'Hornet EC-300',
    ship: 'Hornet EC-300',
    weapon: "Draclira's Modified Tachyon Beam Laser",
    quality: 'Penetrates'
  })
  const i = parseCombatLine(IN)
  assert.equal(i.kind, 'in')
  assert.equal(i.amount, 375)
  assert.equal(i.who, "Tek'wka Rokym")
  assert.equal(i.ship, 'Paladin')
  assert.equal(i.weapon, 'Imperial Navy Large EMP Smartbomb')
  assert.equal(i.quality, 'Hits')
})

test('a real remote repair line', () => {
  const r = parseCombatLine(REP)
  assert.equal(r.kind, 'repIn')
  assert.equal(r.amount, 772)
  assert.equal(r.who, 'Drentu')
  assert.equal(r.ship, 'Osprey')
  assert.equal(r.weapon, 'Medium Ancillary Remote Shield Booster')
})

test('a translated client: direction by colour, names from the hint as this client writes them', () => {
  // The hint form is real (from a Russian client's log); the word for "to" is whatever the client says.
  const e = parseCombatLine('[ 2026.11.03 14:23:55 ] (combat) <color=0xff00ffff><b>120</b> <color=0x77ffffff><font size=10>по</font> <b><color=0xffffffff><localized hint="Guristas Arch Mortifier">Гуристас*</b><font size=10><color=0x77ffffff> - <localized hint="Hobgoblin II">Хобгоблин*</localized> - Hits')
  assert.equal(e.kind, 'out')
  assert.equal(e.amount, 120)
  assert.equal(e.who, 'Guristas Arch Mortifier')
  assert.equal(e.weapon, 'Hobgoblin II')
})

test('an NPC line with no weapon', () => {
  const e = parseCombatLine('[ 2024.01.01 10:00:00 ] (combat) <color=0xffcc0000><b>40</b> <color=0x77ffffff><font size=10>from</font> <b><color=0xffffffff>Guristas Silencer</b><font size=10><color=0x77ffffff> - Grazes')
  assert.equal(e.who, 'Guristas Silencer')
  assert.equal(e.weapon, undefined)
  assert.equal(e.quality, 'Grazes')
})

test('misses, from memory of the format', () => {
  const a = parseCombatLine('[ 2024.01.01 10:00:00 ] (combat) Your group of Hobgoblin II misses Guristas Silencer completely - Hobgoblin II')
  assert.equal(a.kind, 'missOut')
  assert.equal(a.who, 'Guristas Silencer')
  assert.equal(a.weapon, 'Hobgoblin II')
  const b = parseCombatLine('[ 2024.01.01 10:00:00 ] (combat) Guristas Silencer misses you completely - Light Neutron Blaster')
  assert.equal(b.kind, 'missIn')
  assert.equal(b.who, 'Guristas Silencer')
  assert.equal(b.weapon, 'Light Neutron Blaster')
})

test('what is not understood is kept as text, and other lines are not combat', () => {
  const e = parseCombatLine('[ 2024.01.01 10:00:00 ] (combat) <color=0xffffffff>Что-то совсем новое')
  assert.equal(e.kind, 'unknown')
  assert.equal(e.text, 'Что-то совсем новое')
  assert.equal(parseCombatLine('[ 2026.11.03 14:25:08 ] (None) Осуществляется прыжок'), null)
  assert.equal(parseCombatLine('  Игровой журнал'), null)
})

const T = Date.UTC(2026, 0, 1)
const hit = (sec, amount, o = {}) => ({ t: T + sec * 1000, kind: 'out', amount, who: 'A', weapon: 'Gun', quality: 'Hits', ...o })
const miss = (sec, o = {}) => ({ t: T + sec * 1000, kind: 'missOut', amount: 0, who: 'A', weapon: 'Gun', ...o })
const took = (sec, amount, o = {}) => ({ t: T + sec * 1000, kind: 'in', amount, who: 'B', weapon: 'Rail', quality: 'Hits', ...o })

test('a quiet minute splits fights; seconds and dps of each', () => {
  const f = buildFights([hit(0, 100), hit(20, 300), hit(80, 50), hit(200, 10)])
  assert.equal(f.length, 3) // 20→80 is exactly a minute
  assert.equal(f[0].seconds, 20)
  assert.equal(f[0].dealt.damage, 400)
  assert.equal(f[0].dealt.dps, 20)
  // A single shot still has a duration to divide by.
  assert.equal(f[2].seconds, 1)
})

test('peak dps is the best ten seconds', () => {
  const f = buildFights([hit(0, 100), hit(5, 100), hit(9, 100), hit(10, 700), hit(30, 10)])
  // 5,9,10 → 900 in 10 s; 0,5,9 → 300.
  assert.equal(f[0].dealt.peakDps, 90)
})

test('by weapon: hit rate, average, biggest, and how much only glanced', () => {
  const f = buildFights([
    hit(0, 100),
    hit(1, 50, { quality: 'Glances Off' }),
    hit(2, 30, { quality: 'Grazes' }),
    hit(3, 300, { quality: 'Smashes' }),
    miss(4),
    hit(5, 10, { weapon: 'Drone' })
  ])[0]
  const gun = f.dealt.weapons[0]
  assert.equal(gun.name, 'Gun')
  assert.equal(gun.damage, 480)
  assert.equal(gun.hits, 4)
  assert.equal(gun.misses, 1)
  assert.equal(gun.hitRate, 0.8)
  assert.equal(gun.average, 120)
  assert.equal(gun.biggest, 300)
  assert.equal(gun.weak, 0.5)
  assert.deepEqual(gun.quality, { Hits: 1, 'Glances Off': 1, Grazes: 1, Smashes: 1 })
  assert.equal(f.dealt.weapons[1].name, 'Drone')
})

test('sides stay apart, repairs and unknown lines are counted', () => {
  const f = buildFights([
    hit(0, 100),
    took(1, 40),
    { t: T + 2000, kind: 'repIn', amount: 772, who: 'X' },
    { t: T + 3000, kind: 'repOut', amount: 5, who: 'Y' },
    { t: T + 4000, kind: 'cap', amount: 20, who: '' },
    { t: T + 5000, kind: 'ewar', amount: 0, who: '', text: 'scram' },
    { t: T + 6000, kind: 'ewar', amount: 0, who: '', text: 'scram' },
    { t: T + 7000, kind: 'unknown', amount: 0, who: '', text: '??' }
  ])[0]
  assert.equal(f.dealt.damage, 100)
  assert.equal(f.taken.damage, 40)
  assert.equal(f.repairedIn, 772)
  assert.equal(f.repairedOut, 5)
  assert.equal(f.capacitor, 20)
  assert.deepEqual(f.ewar, ['scram'])
  assert.deepEqual(f.unknown, ['??'])
})

const shots = (n, fn) => Array.from({ length: n }, (_, i) => fn(i))

test('findings: misses and weak hits only with enough shots', () => {
  const few = buildFights([...shots(5, (i) => miss(i))])[0]
  assert.deepEqual(findings(few), [])
  const bad = buildFights([...shots(4, (i) => hit(i, 10, { quality: 'Grazes' })), ...shots(6, (i) => miss(i + 4))])[0]
  assert.deepEqual(findings(bad), [
    { code: 'misses', weapon: 'Gun', percent: 60 },
    { code: 'weakHits', weapon: 'Gun', percent: 100 }
  ])
  // 70% hits is not a finding, a hair under is.
  const edge = buildFights([...shots(7, (i) => hit(i, 10)), ...shots(3, (i) => miss(i + 7))])[0]
  assert.deepEqual(findings(edge), [])
})

test('findings: outdamaged, one attacker doing most, tackle', () => {
  const f = buildFights([
    hit(0, 10),
    ...shots(10, (i) => took(i, 100)),
    took(11, 100, { who: 'C' }),
    { t: T + 12000, kind: 'ewar', amount: 0, who: '', text: 'scram' }
  ])[0]
  assert.deepEqual(findings(f), [
    { code: 'outdamaged', dealt: 10, taken: 1100 },
    { code: 'focus', who: 'B', percent: 91 },
    { code: 'tackled', lines: 1 }
  ])
})
