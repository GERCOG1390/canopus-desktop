// Link preview cards (Open Graph, 1200×630) for canopusapp.com: what Discord, Reddit, Telegram and others
// show when someone pastes a link. One card per page, rendered from HTML by headless Chrome into docs/og/.
//
//   node tools/site/og.mjs            (needs Google Chrome; set CHROME=/path/to/chrome elsewhere)
//
// Run it after changing a page's title here or one of the screenshots; tools/site/build.mjs points every page at
// og/<page>.png, and checks that the card exists.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { markSvg } from '../../src/shared/brandMark.ts'

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** page → what its card says and shows. Keep the titles short: the card is often seen at 400 px wide. */
export const CARDS = {
  index: { eyebrow: 'Free EVE Online companion', title: 'Fight the battle before you undock', line: 'Combat simulator · fitting · intel · 3D map · market', shot: 'shots/simulator.webp' },
  fitting: { eyebrow: 'Fitting tool', title: 'Same numbers as Pyfa', line: 'Checked on 44 fits with no differences · price optimizer', shot: 'shots/fitting.webp' },
  'combat-simulator': { eyebrow: 'Combat simulator', title: 'Know what would change the fight', line: 'Your fit against theirs, second by second', shot: 'shots/what-if.webp' },
  intel: { eyebrow: 'Intel and overlay', title: 'Local and intel, jumps away', line: 'Every pilot checked · an overlay over the game', shot: 'screenshots/intel-local.png' },
  map: { eyebrow: '3D map and travel', title: 'The whole of New Eden in 3D', line: 'Security, stargates, recent kills, sovereignty, routes', shot: 'screenshots/galaxy-map.png' },
  'market-industry': { eyebrow: 'Market and industry', title: 'What the market really pays', line: 'Fees from your skills · industry · planetary industry', shot: 'screenshots/production-chain.png' },
  character: { eyebrow: 'Characters', title: 'All your pilots in one place', line: 'Skill queues, ISK, industry, PI, jump fatigue', shot: 'screenshots/overview.png' },
  assistant: { eyebrow: 'AI assistant', title: 'Ask about your fits and the game', line: 'Answers from your own data', shot: 'shots/optimizer.webp' },
  download: { eyebrow: 'Download', title: 'Canopus for Windows, macOS and Linux', line: 'Free, no ads, no subscriptions · iPhone & iPad', shot: 'shots/simulator.webp' },
  changelog: { eyebrow: 'What’s new', title: 'Every release, and what it brought', line: 'Canopus updates itself', shot: 'shots/what-if.webp' },
  faq: { eyebrow: 'Questions and answers', title: 'Canopus, explained', line: 'Installing, logging in, intel, your data', shot: 'shots/fitting.webp' },
  privacy: { eyebrow: 'Privacy', title: 'Your data stays on your computer', line: 'No telemetry, no accounts', shot: 'shots/simulator.webp' }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const asset = (p) => pathToFileURL(join(DOCS, p)).href

function cardHtml({ eyebrow, title, line, shot }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
@font-face { font-family: 'Exo 2'; font-weight: 700; src: url('${asset('assets/fonts/exo-2-latin-700-normal.woff2')}'); }
@font-face { font-family: 'Plex'; font-weight: 500; src: url('${asset('assets/fonts/ibm-plex-sans-latin-500-normal.woff2')}'); }
* { margin: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body {
  background: radial-gradient(ellipse 70% 90% at 85% 10%, rgba(61,191,156,.20), transparent 60%),
    radial-gradient(ellipse 50% 60% at 0% 100%, rgba(255,217,138,.10), transparent 70%), #101113;
  color: #e9ecef; font-family: 'Plex', sans-serif; position: relative;
}
.stars { position: absolute; inset: 0; background-image:
  radial-gradient(1.2px 1.2px at 12% 18%, #fff8, transparent), radial-gradient(1px 1px at 34% 72%, #fff6, transparent),
  radial-gradient(1.4px 1.4px at 48% 12%, #ffd98aaa, transparent), radial-gradient(1px 1px at 8% 64%, #fff5, transparent),
  radial-gradient(1px 1px at 26% 40%, #8fe0c888, transparent), radial-gradient(1.2px 1.2px at 42% 88%, #fff6, transparent),
  radial-gradient(1px 1px at 18% 90%, #fff4, transparent), radial-gradient(1.3px 1.3px at 38% 30%, #fff7, transparent); }
.text { position: absolute; left: 72px; top: 64px; width: 560px; height: 502px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 14px; font-family: 'Exo 2'; font-weight: 700; font-size: 26px; letter-spacing: .22em; }
.eyebrow { margin-top: auto; color: #8fe0c8; font-size: 19px; letter-spacing: .2em; text-transform: uppercase; }
h1 { margin-top: 16px; font-family: 'Exo 2'; font-weight: 700; font-size: 62px; line-height: 1.06; letter-spacing: -.005em; }
p { margin-top: 22px; color: #aeb4bb; font-size: 24px; line-height: 1.35; }
.url { margin-top: 30px; color: #6f767e; font-size: 20px; letter-spacing: .04em; }
.shot { position: absolute; left: 690px; top: 92px; width: 760px; border-radius: 14px; border: 1px solid #3c3f45;
  box-shadow: 0 40px 90px -20px #000, 0 0 0 1px #0006; transform: perspective(1400px) rotateY(-14deg) rotateX(3deg);
  transform-origin: left center; }
.fade { position: absolute; inset: 0 0 0 auto; width: 120px; background: linear-gradient(90deg, transparent, #101113cc); }
</style></head><body>
<div class="stars"></div>
<img class="shot" src="${asset(shot)}" />
<div class="fade"></div>
<div class="text">
  <div class="brand">${markSvg({ size: 46, p: 'og' })}CANOPUS</div>
  <div class="eyebrow">${esc(eyebrow)}</div>
  <h1>${esc(title)}</h1>
  <p>${esc(line)}</p>
  <div class="url">canopusapp.com</div>
</div>
</body></html>`
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tmp = mkdtempSync(join(tmpdir(), 'canopus-og-'))
  mkdirSync(join(DOCS, 'og'), { recursive: true })
  try {
    for (const [name, card] of Object.entries(CARDS)) {
      const html = join(tmp, `${name}.html`)
      writeFileSync(html, cardHtml(card))
      execFileSync(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
        '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=3000',
        `--screenshot=${join(DOCS, 'og', `${name}.png`)}`, pathToFileURL(html).href
      ], { stdio: 'ignore' })
      console.log(`og/${name}.png`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
