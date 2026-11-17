import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadFromCargo, mutationRef, parseFittingXml, splitEft, splitMutations, toEftBlocks, xmlFitToEft } from './fitImport.ts'

const xml = `<?xml version="1.0" ?>
<fittings>
  <fitting name="Rifter &amp; co">
    <description value=""/>
    <shipType value="Rifter"/>
    <hardware slot="hi slot 1" type="125mm Gatling AutoCannon II"/>
    <hardware slot="hi slot 0" type="125mm Gatling AutoCannon II"/>
    <hardware slot="med slot 0" type="1MN Afterburner II"/>
    <hardware slot="low slot 0" type="Gyrostabilizer II"/>
    <hardware slot="rig slot 0" type="Small Projectile Burst Aerator I"/>
    <hardware qty="2" slot="drone bay" type="Warrior II"/>
    <hardware qty="400" slot="cargo" type="EMP S"/>
  </fitting>
  <fitting name="Kestrel">
    <shipType value="Kestrel"/>
    <hardware slot="hi slot 0" type="Light Missile Launcher II"/>
  </fitting>
</fittings>`

test('the EVE XML fittings file: every fit, names unescaped', () => {
  const fits = parseFittingXml(xml)
  assert.equal(fits.length, 2)
  assert.equal(fits[0].name, 'Rifter & co')
  assert.equal(fits[0].ship, 'Rifter')
  assert.equal(fits[0].hardware.find((h) => h.slot === 'cargo').qty, 400)
})

test('an XML fit becomes EFT in the game order: low, mid, high, rigs, then drones and cargo', () => {
  const eft = xmlFitToEft(parseFittingXml(xml)[0])
  assert.equal(
    eft,
    '[Rifter, Rifter & co]\n\nGyrostabilizer II\n\n1MN Afterburner II\n\n125mm Gatling AutoCannon II\n125mm Gatling AutoCannon II\n\nSmall Projectile Burst Aerator I\n\nWarrior II x2\n\nEMP S x400'
  )
})

test('several EFT fits pasted together are split at their headers, not at empty slots', () => {
  const text = '[Rifter, A]\nGyrostabilizer II\n[Empty Med slot]\n\n125mm Gatling AutoCannon II, EMP S\n\n[Kestrel, B]\nLight Missile Launcher II'
  const blocks = splitEft(text)
  assert.equal(blocks.length, 2)
  assert.ok(blocks[0].includes('[Empty Med slot]'))
  assert.ok(blocks[1].startsWith('[Kestrel, B]'))
})

test('whatever is given: XML or EFT', () => {
  assert.equal(toEftBlocks(xml).length, 2)
  assert.equal(toEftBlocks('[Rifter, A]\nGyrostabilizer II').length, 1)
  assert.equal(toEftBlocks('just text').length, 0)
})

// Review 2026-11-15: the EVE XML file (Pyfa's and the game's) lists charges only as cargo, so imported guns had
// no ammo and the fit showed 0 DPS.
test('modules without a charge are loaded with the first fitting charge from the cargo', () => {
  const modules = [
    { typeId: 1, slot: 'hi', state: 'active' },
    { typeId: 1, slot: 'hi', state: 'active' },
    { typeId: 2, slot: 'med', state: 'active' },
    { typeId: 3, slot: 'hi', state: 'active', chargeTypeId: 99 }
  ]
  const cargo = [
    { typeId: 50, qty: 10 },
    { typeId: 40, qty: 400 }
  ]
  const fits = { 1: [40, 41], 3: [40] }
  const out = loadFromCargo(modules, cargo, (id) => fits[id] ?? [])
  assert.deepEqual(
    out.map((m) => m.chargeTypeId),
    [40, 40, undefined, 99]
  )
})

// Review 2026-11-15: Pyfa's EFT for mutated (abyssal) modules — "Name [1]" on the module, a block per mutation
// after the fit — ended up as unknown lines and a mutaplasmid in the cargo.
test("Pyfa's mutated modules: the reference on the module and the block after the fit", () => {
  const text = `[Vexor, Web Vexor]
Stasis Webifier II [1]
Warp Disruptor II [2], 
Drone Damage Amplifier II

[1] Stasis Webifier II
  Unstable Stasis Webifier Mutaplasmid
  cpu 23.4, maxRange 13250.5, speedFactor -62.1
[2] Warp Disruptor II
  Gravid Warp Disruptor Mutaplasmid
  maxRange 31000`
  const { body, mutations } = splitMutations(text)
  assert.ok(!body.includes('Mutaplasmid'))
  assert.ok(!body.includes('[1] '))
  assert.equal(mutations.size, 2)
  assert.deepEqual(mutations.get(1), { ref: 1, base: 'Stasis Webifier II', mutaplasmid: 'Unstable Stasis Webifier Mutaplasmid', attrs: { cpu: 23.4, maxRange: 13250.5, speedFactor: -62.1 } })
  assert.deepEqual(mutationRef('Stasis Webifier II [1]'), { name: 'Stasis Webifier II', ref: 1 })
  assert.deepEqual(mutationRef('Warp Disruptor II [2]'), { name: 'Warp Disruptor II', ref: 2 })
  assert.equal(mutationRef('Drone Damage Amplifier II'), null)
})
