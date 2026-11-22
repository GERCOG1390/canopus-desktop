import assert from 'node:assert/strict'
import { test } from 'node:test'
import { damageChance, HeatState, rackHeat, secondsToHeat } from './heat.ts'

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

// EVE University, Overheating: a frigate overheating one Warp Scrambler I (0.01): 69.3 s to 50%, 230.3 s to 90%.
test('a rack heats as the game formula says', () => {
  close(secondsToHeat(0.5, 1, 0.01), 69.3, 0.05)
  close(secondsToHeat(0.9, 1, 0.01), 230.3, 0.05)
  // A Catalyst (0.85) with eight Light Neutron Blaster II (0.02 each): 5.1 s to 50%, 16.9 s to 90%.
  close(secondsToHeat(0.5, 0.85, 8 * 0.02), 5.1, 0.05)
  close(secondsToHeat(0.9, 0.85, 8 * 0.02), 16.9, 0.05)
  // Stepped in small pieces it lands in the same place.
  let h = 0
  for (let t = 0; t < 69.3; t += 0.1) h = rackHeat(h, 0.1, 1, 0.01, 0.01)
  close(h, 0.5, 0.01)
})

// The page: 90% to 50% takes 58.8 s, 50% to 20% 91.6 s.
test('a rack cools by 1% of its heat a second', () => {
  close(rackHeat(0.9, 58.8, 1, 0, 0.01), 0.5, 0.005)
  close(rackHeat(0.5, 91.6, 1, 0, 0.01), 0.2, 0.005)
})

// The page's Enyo: 60% rack heat, 5/3/4 slots and 2 rigs (14), one high empty (11 online): 47.1%, 23.6%, 11.8%.
test('the damage chance falls off with distance in the rack', () => {
  close(damageChance(0.6, 11, 14, 0.5, 0), 0.471, 0.001)
  close(damageChance(0.6, 11, 14, 0.5, 1), 0.236, 0.001)
  close(damageChance(0.6, 11, 14, 0.5, 2), 0.118, 0.001)
})

const rifter = (policy) =>
  new HeatState(
    {
      generation: 1,
      racks: { hi: { dissipation: 0.01, attenuation: 0.5 }, med: { dissipation: 0.01, attenuation: 0.5 }, lo: { dissipation: 0.01, attenuation: 0.63 } },
      slots: 13,
      modules: [
        // Web II, Scram II, 1MN AB II in the mids (Thermodynamics V), a Damage Control in the lows.
        { index: 0, rack: 'med', pos: 0, hp: 40, absorb: 0.02, damage: 3.75 },
        { index: 1, rack: 'med', pos: 1, hp: 40, absorb: 0.02, damage: 3.75 },
        { index: 2, rack: 'med', pos: 2, hp: 40, absorb: 0.04, damage: 7.2 },
        { index: 3, rack: 'lo', pos: 0, hp: 40 }
      ]
    },
    policy
  )

test('overheating to the end burns modules out, and only the rack that heats', () => {
  const s = rifter('burn')
  let burnt = []
  for (let t = 0; t < 300 && burnt.length === 0; t += 1) {
    s.step(1, () => true)
    // Each module ends a cycle every 5 s.
    if (t % 5 === 4) for (const i of [0, 1, 2]) burnt = burnt.concat(s.cycled(i))
  }
  assert.ok(burnt.length > 0, 'something burns out')
  assert.equal(s.heat.lo, 0)
  assert.equal(s.damage.get(3) ?? 0, 0)
  // The afterburner deals the most and sits next to the scram: the middle and the AB go first, not the web.
  assert.ok((s.damage.get(0) ?? 0) < (s.damage.get(1) ?? 0))
  assert.equal(s.hot(burnt[0]), false)
})

test("safe heat takes the rack off overheat before anything burns, and it cools", () => {
  const s = rifter('safe')
  for (let t = 0; t < 600; t += 1) {
    s.step(1, () => true)
    if (t % 5 === 4) for (const i of [0, 1, 2]) s.cycled(i)
  }
  assert.equal(s.burnt.size, 0)
  assert.ok(s.cooled.has('med'))
  assert.ok(s.heat.med < 0.5, `${s.heat.med}`)
  assert.equal(s.hot(0), false)
})

test('no heat: nothing overheats, nothing heats up', () => {
  const s = rifter('off')
  s.step(10, () => true)
  assert.equal(s.cycled(0).length, 0)
  assert.equal(s.peak(), 0)
})
