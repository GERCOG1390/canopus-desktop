# Testing Canopus

How builds are checked, and how bugs and inaccuracies are tracked.

## The release gate: `npm run check`

Run it on the commit to be released. It needs a clean working tree and an SDE (open Canopus once so it
builds one). It takes a few minutes.

| Step | What it catches |
|---|---|
| Types | type errors in main, preload and renderer |
| Unit tests (`src/shared/*.test.mjs`) | the game's formulas and every bug found so far, each with its real numbers |
| Golden figures (`npm run golden`) | any change in the numbers of 28 reference fits and 11 reference fights (see below) |
| App build | the bundle builds |
| Every screen | the app opens every section, every tab and the combat simulator, in English, on a test profile. It records console errors, error boxes, Russian text left untranslated and crashes, and makes a contact sheet. It captures the Canopus windows only. |

On success it stamps the commit (`.release/checked-<sha>`, not committed). Before building a release,
`node tools/check/stamped.mjs v1.x.y` refuses a tag whose commit has no stamp.

Options:
- `--dirty` checks uncommitted work (no stamp).
- `--quick` runs only types, tests and golden figures (not enough for a release).

## Golden figures

- `tests/golden/fits.eft`: reference fits, in EFT. Add a fit for every new kind of mechanic: hulls, T3,
  mutated modules, boosts, overheating, and so on.
- `tests/golden/fights.json`: reference fights. Each one names two fits and a scenario.
- `tests/golden/expected.json`: their figures, recorded by the real engine on the real SDE (all skills V).

`npm run golden` reports every figure that moved.

- If it is a bug, fix it.
- If the change is intended, run `npm run golden -- --update` and say why in the commit.
- A new SDE (a balance patch) moves numbers legitimately. The report says when the SDE build differs from
  the recorded one.

The engine was checked against Pyfa (44 fits, 0 differences, Canopus 1.1). When a figure is in doubt, Pyfa
and the game are the references.

## CI

`.github/workflows/ci.yml` runs types and unit tests on every push. The golden figures and the screen run
need an SDE and a display, so they run locally in the gate.

## Bugs and inaccuracies

- Issues use two templates: **Bug** and **Inaccuracy**. An Inaccuracy report carries the fit in EFT, what the
  game shows, what Canopus shows, and Pyfa if checked.
- In the app, Settings → Help has **Report a bug** and **Report an inaccuracy**. Both fill in the version
  and the platform.
- Every confirmed bug or inaccuracy gets a test with its real numbers before the fix. The test comment says
  where it came from: issue number, forum post, or the pilot's own case. A fit-level inaccuracy also goes
  into `tests/golden/fits.eft`.
