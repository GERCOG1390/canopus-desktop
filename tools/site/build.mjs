// Builds the Canopus website into docs/ (served by GitHub Pages from main/docs).
// Run: node tools/site/build.mjs — then commit docs/. Facts come from README.md; keep them in step.
// When the site moves to its own domain: change SITE and BASE below and add docs/CNAME.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'https://canopusapp.com/'
/** Path of the site on its host (404.html needs absolute links); '/' on an own domain. */
const BASE = '/'
const REPO = 'https://github.com/GERCOG1390/canopus-desktop'
const RELEASES = `${REPO}/releases/latest`
const APP_STORE = 'https://apps.apple.com/us/app/canopus-for-eve-online/id6829985678'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs')

const NAV = [
  ['fitting.html', 'Fitting'],
  ['combat-simulator.html', 'Simulator'],
  ['intel.html', 'Intel'],
  ['map.html', 'Map'],
  ['market-industry.html', 'Market'],
  ['faq.html', 'FAQ']
]

const FEATURE_PAGES = [
  ['fitting.html', 'Fitting tool', 'A dogma engine of its own, checked against Pyfa. Live preview, damage graph, boosters, fleet boosts.', 'screenshots/fitting.png'],
  ['combat-simulator.html', 'Combat simulator', 'Your fit against theirs, flown second by second, with a replay and “Find the best”.', 'screenshots/combat.png'],
  ['intel.html', 'Intel and overlay', 'Local scan, intel channels, D-scan, an always-on-top overlay and Discord alerts.', 'screenshots/intel-local.png'],
  ['map.html', '3D map and travel', 'New Eden in 3D with kills, routes, jump bridges, sovereignty and route safety.', 'screenshots/galaxy-map.png'],
  ['market-industry.html', 'Market and industry', 'Honest market numbers, arbitrage, production chains, invention and PI.', 'screenshots/production-chain.png'],
  ['character.html', 'Characters', 'All your characters on one screen, skill plans with remaps, wallet, assets and notifications.', 'screenshots/overview.png'],
  ['assistant.html', 'AI assistant', 'An optional chat that answers from your own Canopus data, not from guesses.', null]
]

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function page({ file, title, description, body, image = 'media/trailer.png', current = file }) {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('\n        ')
  const full = file === 'index.html' ? title : `${title} — Canopus`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${SITE}${file === 'index.html' ? '' : file}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Canopus" />
<meta property="og:title" content="${esc(full)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${SITE}${image}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#131416" />
<link rel="icon" href="assets/icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="assets/icon.png" />
<link rel="preload" href="assets/fonts/exo-2-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="assets/site.css" />
<script src="assets/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="wrap">
    <a class="brand" href="./" aria-label="Canopus home"><img src="assets/icon.svg" alt="" width="30" height="30" /><span>CANOPUS</span></a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav class="nav" id="site-nav" aria-label="Main">
        ${nav}
        <a class="btn" href="download.html"${current === 'download.html' ? ' aria-current="page"' : ''}>Download</a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-foot">
  <div class="wrap">
    <div class="cols">
      <nav aria-label="Features">
        ${FEATURE_PAGES.map(([href, label]) => `<a href="${href}">${label}</a>`).join('\n        ')}
      </nav>
      <nav aria-label="More">
        <a href="download.html">Download</a>
        <a href="changelog.html">What's new</a>
        <a href="faq.html">FAQ</a>
        <a href="privacy.html">Privacy</a>
        <a href="trailer.html">Trailer</a>
        <a href="${REPO}">GitHub</a>
        <a href="${REPO}/discussions">Discussions</a>
        <a href="${REPO}/issues">Report a bug</a>
      </nav>
    </div>
    <p class="legal">Canopus is free and source-available (<a href="${REPO}/blob/main/LICENSE">PolyForm Strict 1.0.0</a>). EVE Online and all related materials are trademarks or property of CCP hf. Canopus is a third-party application and is not affiliated with or endorsed by CCP hf. Game data and images are used under CCP's developer license.</p>
  </div>
</footer>
</body>
</html>
`
}

const cta = (text = 'Free, no ads, no subscriptions. Windows, macOS and Linux — and a separate app for iPhone and iPad.') => `<section class="cta">
  <div class="wrap">
    <h2>Fight the battle before you undock</h2>
    <p>${text}</p>
    <div class="hero-actions">
      <a class="btn" data-download-primary href="download.html">Download Canopus</a>
      <a class="btn ghost" href="download.html">All downloads</a>
    </div>
    <p class="hero-note" data-download-note></p>
  </div>
</section>`

const ticks = (items) => `<ul class="ticks">\n${items.map((i) => `  <li>${i}</li>`).join('\n')}\n</ul>`

/** A text block beside its picture; without a picture (no screenshot shows it) the text gets the whole width. */
function feature({ title, text, items, img, alt, flip = false, level = 'h2' }) {
  return `<div class="feature${flip ? ' flip' : ''}${img ? '' : ' text-only'}">
  <div class="feature-text">
    <${level}>${title}</${level}>
    ${[].concat(text).map((p) => `<p>${p}</p>`).join('\n    ')}
    ${items ? ticks(items) : ''}
  </div>
  ${img ? `<figure><img src="${img}" alt="${esc(alt)}" loading="lazy" /></figure>` : ''}
</div>`
}

function featurePage({ file, title, description, eyebrow, lead, image, sections }) {
  return page({
    file,
    title,
    description,
    image,
    body: `<section class="hero">
  <div class="wrap" style="grid-template-columns: 1fr">
    <div>
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      <p class="lead" style="max-width: 820px">${lead}</p>
    </div>
  </div>
</section>
<section class="block" style="border-top: 0; padding-top: 0">
  <div class="wrap">
${sections.map((s, i) => feature({ ...s, flip: i % 2 === 1 })).join('\n')}
  </div>
</section>
${cta()}`
  })
}

const files = {}

// ---------------------------------------------------------------- home
files['index.html'] = page({
  file: 'index.html',
  title: 'Canopus — the free EVE Online companion',
  description:
    'Canopus is a free EVE Online companion for Windows, macOS and Linux: a combat simulator, a fitting tool checked against Pyfa, Local and intel channel monitoring with an overlay, a 3D map, honest market numbers and industry.',
  body: `<section class="hero">
  <div class="wrap">
    <div>
      <div class="eyebrow">Free EVE Online companion</div>
      <h1>Fight the battle before you undock</h1>
      <p class="lead">Fit your ship, fly the fight second by second against theirs, watch Local and your intel channels, plan routes on a 3D map and see what the market really pays — in one app for Windows, macOS and Linux.</p>
      <div class="hero-actions">
        <a class="btn" data-download-primary href="download.html">Download Canopus</a>
        <a class="btn ghost" href="trailer.html">Watch the trailer</a>
      </div>
      <p class="hero-note" data-download-note>Free, no ads, no subscriptions. Nothing is sent to the developer.</p>
      <div class="platforms"><span class="chip">Windows 10/11</span><span class="chip">macOS 12+ · signed by Apple</span><span class="chip">Linux</span><span class="chip">iPhone &amp; iPad</span><span class="chip">English / Русский</span></div>
    </div>
    <div class="hero-media">
      <video src="media/canopus-trailer.mp4" poster="media/trailer.png" controls muted playsinline preload="none" aria-label="Canopus trailer, 53 seconds"></video>
    </div>
  </div>
</section>

<section class="block">
  <div class="wrap">
    <div class="section-head">
      <div class="rule">What makes it different</div>
      <h2>Numbers you can trust, before the fight</h2>
    </div>
${feature({
  title: 'Fly the fight before you take it',
  level: 'h3',
  text: 'Your fit against theirs, flown second by second: orbits with real inertia, reloads, capacitor, neuts, webs and scrams, the Reactive Armor Hardener adapting, boosters from the first second. Then watch the replay — and press <b>Find the best</b> to let Canopus try every range, ammo and prop module for you.',
  img: 'media/combat-replay.gif',
  alt: 'A fight replayed on the tactical map'
})}
${feature({
  title: 'Every number, live',
  level: 'h3',
  flip: true,
  text: 'Hover a module and every stat updates with the difference highlighted — before you fit it. A dogma engine of its own, checked against Pyfa 2.69.3 on 44 fits with no differences, with all 300 combat boosters in the game.',
  img: 'media/live-preview.gif',
  alt: 'Live preview in the fitting tool'
})}
${feature({
  title: 'See why your missiles miss',
  level: 'h3',
  text: 'Fire any missile at any ship in 3D: the blast grows at its explosion velocity while the target slips away, both to scale, with the game’s formula and its numbers next to it.',
  img: 'media/missile-lab.gif',
  alt: 'The missile lab: the blast grows while the target slips away'
})}
  </div>
</section>

<section class="block">
  <div class="wrap">
    <div class="section-head">
      <div class="rule">Everything in one app</div>
      <h2>Replace the half-dozen tabs</h2>
      <p>Fitting, intel, route safety, the market, industry and every character — on your computer, with your data staying there.</p>
    </div>
    <div class="grid three">
${FEATURE_PAGES.map(
  ([href, label, text, img]) => `      <a class="card-link" href="${href}"><div class="card">
        ${img ? `<img class="shot" src="${img}" alt="" loading="lazy" />` : ''}
        <h3>${label}</h3>
        <p>${text}</p>
        <span class="more">More</span>
      </div></a>`
).join('\n')}
      <a class="card-link" href="${APP_STORE}"><div class="card">
        <img class="shot" src="media/mobile.png" alt="" loading="lazy" />
        <h3>iPhone and iPad</h3>
        <p>A separate mobile app: characters, fits from the same engine, market, industry, PI and the map, with notifications.</p>
        <span class="more">App Store</span>
      </div></a>
    </div>
  </div>
</section>

<section class="block">
  <div class="wrap grid two">
    <div class="card">
      <div class="rule">Fair play</div>
      <h3>Only what the game shows you</h3>
      <p>Canopus uses CCP's ESI and game data, the chat and game logs the client writes to your Documents folder, and what you copy to the clipboard yourself. It never reads the game client's memory and never automates input — the same approach as Pyfa or RIFT.</p>
      <a class="more" href="faq.html#fair-play">Is it allowed?</a>
    </div>
    <div class="card">
      <div class="rule">Your data stays yours</div>
      <h3>Nothing is sent to the developer</h3>
      <p>Login is CCP's own EVE SSO in your browser. Tokens are stored encrypted on your computer and never leave it. No telemetry, no accounts, no ads.</p>
      <a class="more" href="privacy.html">Privacy</a>
    </div>
  </div>
</section>
${cta()}`
})

// ---------------------------------------------------------------- download
files['download.html'] = page({
  file: 'download.html',
  title: 'Download Canopus',
  description: 'Download Canopus for Windows, macOS or Linux, or get the iPhone and iPad app. Free, updates itself.',
  body: `<section class="hero">
  <div class="wrap" style="grid-template-columns: 1fr">
    <div>
      <div class="eyebrow">Version <span data-version>latest</span></div>
      <h1>Download Canopus</h1>
      <p class="lead">Free, no ads, no subscriptions. The Windows, macOS and AppImage builds update themselves after the first install.</p>
    </div>
  </div>
</section>
<section class="block" style="border-top: 0; padding-top: 0">
  <div class="wrap">
    <div class="download-grid">
      <div class="card dl" data-os="windows">
        <h3>Windows <span class="yours">your system</span></h3>
        <div class="files"><a href="${RELEASES}"><span>Installer or portable .exe</span><small>GitHub</small></a></div>
        <p>Windows 10 and 11, x64. Not code-signed yet: if SmartScreen warns on first launch, click <b>More info → Run anyway</b>.</p>
      </div>
      <div class="card dl" data-os="mac">
        <h3>macOS <span class="yours">your system</span></h3>
        <div class="files"><a href="${RELEASES}"><span>Disk image (.dmg)</span><small>GitHub</small></a></div>
        <p>macOS 12 or later, Apple Silicon and Intel. Signed with a Developer ID and notarized by Apple. Open it and drag Canopus to Applications.</p>
      </div>
      <div class="card dl" data-os="linux">
        <h3>Linux <span class="yours">your system</span></h3>
        <div class="files"><a href="${RELEASES}"><span>AppImage or .deb</span><small>GitHub</small></a></div>
        <p>x64, any distribution: <code>chmod +x</code> the AppImage and run it. Finds the chat logs of EVE under Steam's Proton or Wine.</p>
      </div>
      <div class="card dl" data-os="ios">
        <h3>iPhone &amp; iPad <span class="yours">your system</span></h3>
        <div class="files"><a href="${APP_STORE}"><span>Canopus for EVE Online</span><small>App Store</small></a></div>
        <p>A separate mobile app, iOS / iPadOS 26.5 or later. Characters, fits, market, industry, PI and the map.</p>
      </div>
    </div>
    <div class="prose" style="margin-top: 44px">
      <h2>After installing</h2>
      <ol>
        <li><b>Log in with EVE SSO</b> (bottom left). CCP's login page opens in your own browser; Canopus never sees your password.</li>
        <li><b>Settings → Language</b> switches the interface and item names between English and Russian.</li>
        <li>For intel, run EVE windowed or borderless, copy Local with <b>Ctrl+A, Ctrl+C</b> and choose your intel channels.</li>
      </ol>
      <p>On first start Canopus downloads CCP's static game data (about 100 MB) and builds a local database; it updates it when CCP publishes a new build.</p>
      <h2>Verifying a download</h2>
      <p>Every release lists the SHA-256 checksum of each file in its notes and in <code>SHA256SUMS.txt</code>, with a VirusTotal link for each. Windows and Linux builds are made by GitHub Actions from the public source. All files: <a href="${REPO}/releases">releases on GitHub</a>.</p>
    </div>
  </div>
</section>`
})

// ---------------------------------------------------------------- feature pages
files['fitting.html'] = featurePage({
  file: 'fitting.html',
  title: 'Fitting tool',
  eyebrow: 'Coming from Pyfa?',
  image: 'screenshots/fitting.png',
  description:
    'An EVE Online fitting tool with its own dogma engine, checked against Pyfa on 44 fits: live preview, damage graph, ammo table, damage profiles, fleet boosts, boosters, projected effects and Pyfa import.',
  lead: 'Everything you theorycraft with, on the same numbers: a dogma engine driven by CCP’s game data, checked against Pyfa 2.69.3 on 44 fits with no differences. Import all your Pyfa fits at once.',
  sections: [
    {
      title: 'Every stat, live',
      text: 'The numbers you check first — DPS, volley, EHP, CPU and powergrid — are always on top. Hover a module in the list and every stat updates in place, with the difference highlighted.',
      items: [
        'Skills, hull and role bonuses, subsystems, module states (offline, online, active, overheated), charges, drones, implants and stacking penalties',
        'Calculate with <b>all skills V, IV, III or I</b> or with <b>your character’s skills</b>: what to train and how long it takes',
        'Only modules that fit the ship are offered; turret and launcher hardpoints are enforced',
        'Fit cost at Jita, side-by-side comparison and popular fits from zKillboard'
      ],
      img: 'screenshots/fitting.png',
      alt: 'The fitting tool with key numbers on top'
    },
    {
      title: 'Damage graph and ammo table',
      text: 'Applied DPS over distance, the target’s speed or its signature: target presets, your own speed and heading, your webs and painters counted where they reach, drone control range, up to four fits on one graph.',
      items: [
        '<b>Ammo table</b> — every charge your weapons take side by side, and the one that lands most on the chosen target',
        '<b>Incoming damage profiles</b> — omni, one type, your own profiles, or what each mission NPC faction really shoots; the reactive armor hardener settles to it',
        '<b>Fleet boosts</b> from a booster you pick or a saved booster fit, read from CCP’s buff data',
        '<b>Effects from other ships</b>: webs, painters, remote repairs, neutralizers, dampeners, tracking and guidance disruptors (with scripts) and ECM',
        'All 300 combat boosters in the game; tactical destroyer modes, Triglavian disintegrators, Vorton projectors, smartbombs, Bastion and siege, ancillary repairers'
      ]
    },
    {
      title: 'Try a skill before you train it',
      text: 'Set skills to trial levels and see what they change in the fit: arrows on the numbers show the difference from all skills at V.',
      items: ['<b>Price optimizer</b>: the same stats for less ISK, or the upgrades that add the most per million ISK', '<b>Fit snapshot</b>: the whole fit and its stats on one picture'],
      img: 'screenshots/trial-skills.png',
      alt: 'Trial skill levels in the fitting tool'
    },
    {
      title: 'Popular fits from zKillboard',
      text: 'The fits players really fly on the same hull, from recent losses on zKillboard — open any of them in the fitting tool with one click.',
      img: 'screenshots/fit-popular.png',
      alt: 'Popular fits for the same hull'
    },
    {
      title: 'Show Info for everything',
      text: 'Every ship, module and skill opens a panel like the game’s: attributes with their icons, a readable Effects tab, the skill tree with your levels, variations, reprocessing and hub prices.',
      items: ['Import and export EFT (mutated modules included) and Pyfa’s XML', 'Open fits from your character, current ship, a killmail or Show Info', '<b>Save a fit straight to your in-game fittings</b>'],
      img: 'screenshots/show-info.png',
      alt: 'Show Info panel for a ship'
    }
  ]
})

files['combat-simulator.html'] = featurePage({
  file: 'combat-simulator.html',
  title: 'Combat simulator',
  eyebrow: 'Fly the fight before you take it',
  image: 'screenshots/combat.png',
  description:
    'An EVE Online combat simulator: your fit against an opponent, flown second by second with inertia, reloads, capacitor, neuts, webs and scrams, a replay on the tactical map and “Find the best”.',
  lead: 'A separate window that pits your fit against an opponent — any saved fit, one of your in-game fits, an EFT paste or a bare hull — and flies the fight over time.',
  sections: [
    {
      title: 'The fight, second by second',
      text: 'Ships fly under orders — orbit, keep at range, approach, flee, stop or a course you drag on the map — with real inertia and turning.',
      items: [
        'Weapons cycle, reload and spool up; the capacitor drains and recharges; neutralizers and nosferatus bite',
        'Ancillary repairers run dry, the Reactive Armor Hardener adapts cycle by cycle, an assault damage control fires in bursts',
        'Applied DPS for every weapon with the reason it’s reduced: tracking, falloff, explosion radius or velocity',
        'Webs, painters, scrams and prop modules with falloff and stacking penalties; boosters on either side'
      ],
      img: 'screenshots/combat.png',
      alt: 'The combat simulator'
    },
    {
      title: 'Replay and “Find the best”',
      text: 'Replay the fight on the map — shots, hit-point rings, events — with the toughness, capacitor and distance charts as the seek bar.',
      items: ['<b>Find the best</b> tries ranges, flying modes, ammo and MWD/AB as real fights and offers the winner', 'Shows how it holds if the opponent closes in or keeps away, and names what holds your fit back'],
      img: 'media/combat-replay.gif',
      alt: 'A fight replayed on the tactical map'
    },
    {
      title: 'Missile lab',
      text: 'Fire any missile at any ship in 3D: the blast grows at its explosion velocity while the target slips away, both to scale, with the game’s formula next to it. Signature, speed, explosion radius and velocity finally make sense.',
      img: 'screenshots/missile-lab.png',
      alt: 'The missile lab'
    }
  ]
})

files['intel.html'] = featurePage({
  file: 'intel.html',
  title: 'Intel and overlay',
  eyebrow: 'Know who is in Local',
  image: 'screenshots/intel-local.png',
  description:
    'EVE Online intel tool: Local scan with threat levels, intel channel monitoring with jump distances, D-scan analysis, an always-on-top overlay, multi-client previews and Discord alerts.',
  lead: 'Copy Local and every pilot is checked. Canopus follows your alliance’s intel channels and tells you how many jumps away each report is — with an overlay over the game.',
  sections: [
    {
      title: 'Local scan',
      text: 'Press <b>Ctrl+A, Ctrl+C</b> in the Local window: every pilot is checked for corporation, alliance, age, kills and losses, danger ratio and favourite ships.',
      items: ['Threat shown as a meter with a word, not colour alone', 'New arrivals highlighted; an alert in the app and a desktop notification when a dangerous pilot enters', '<b>D-scan and fleet window</b> analysis with warnings for interdictors, bombers, recons, logistics and capitals'],
      img: 'screenshots/intel-local.png',
      alt: 'Local scan with threat levels'
    },
    {
      title: 'Intel channels',
      text: 'Canopus follows your alliance’s intel chat logs, recognises systems (including shorthand like “1DQ”) and ships in every report and shows how many jumps away they are.',
      items: ['Reports within your range raise an alert; “clr” and “nv” mean all clear', '<b>Alerts in Discord</b> — the same Local and intel alerts posted to your channel through a webhook'],
      img: 'screenshots/intel-channels.png',
      alt: 'Intel channel feed with jump distances'
    },
    {
      title: 'Overlay and mini-windows',
      text: 'An always-on-top overlay for windowed or borderless mode — <b>Ctrl+Shift+L</b> to show or hide, <b>Ctrl+Shift+K</b> for click-through — and small mini-windows over the game: timers of every character, a Jita price lookup, wallets.',
      items: ['<b>Multi-client previews</b>: a live tile of every EVE client; click one or press a hotkey to bring it to the front. No keys or clicks are sent to the game.'],
      img: 'screenshots/overlay.png',
      alt: 'The intel overlay'
    }
  ]
})

files['map.html'] = featurePage({
  file: 'map.html',
  title: '3D map and travel',
  eyebrow: 'New Eden at real coordinates',
  image: 'screenshots/galaxy-map.png',
  description:
    'EVE Online 3D galaxy map with kills in the last hour, routes, Ansiblex jump bridges, sovereignty and Skyhooks, plus route safety with gate camps, a capital jump planner, wormholes and a hauling plan.',
  lead: 'Rotate and zoom New Eden at the real coordinates from CCP’s game data, with security colours, stargates, recent kills and your routes.',
  sections: [
    {
      title: 'The galaxy, live',
      text: 'Kills in the last hour as a glow, routes (secure, shortest, low and null) drawn on the map with the busiest systems on the way, set in game with one click.',
      items: ['<b>Alliance jump bridges</b> — paste the list (plain or Dotlan format), route through them', '<b>Avoided systems</b> and <b>notes</b> per system; avoided systems are left out of every route', '<b>Capital jump range</b> — a sphere around any system and every system it reaches', 'Fresh intel reports and your current system marked on the map'],
      img: 'screenshots/galaxy-map.png',
      alt: 'The 3D galaxy map'
    },
    {
      title: 'Sovereignty',
      text: 'Systems coloured by the alliance holding them, raidable Skyhooks and sovereignty timers marked.',
      img: 'screenshots/galaxy-sovereignty.png',
      alt: 'Sovereignty on the 3D map'
    },
    {
      title: 'Route safety and travel',
      text: 'Every system on the route with security, ship and pod kills in the last hour and gate camps from zKillboard; set the destination in the game with one click.',
      items: ['<b>Hauling plan</b> — a shopping list split into trips by hold size and ISK at risk', '<b>Jump planner</b> for capitals and black ops: range with your skills, fuel and jump fatigue', '<b>Wormholes</b> — any hole type and how many of your ships can pass; Thera and Turnur connections from EVE-Scout'],
      img: 'screenshots/route-safety.png',
      alt: 'Route safety with kills and gate camps'
    }
  ]
})

files['market-industry.html'] = featurePage({
  file: 'market-industry.html',
  title: 'Market and industry',
  eyebrow: 'Honest numbers',
  image: 'screenshots/production-chain.png',
  description:
    'EVE Online market and industry tools: arbitrage through the real order books, real sale prices, LP store, production chains, invention, ore for minerals, PI calculator and moon mining.',
  lead: 'What selling really fetches — not a lone listing nobody takes. Fees from your skills and standings, batches bought up the order book, and the real trades behind every price.',
  sections: [
    {
      title: 'Market',
      text: 'The in-game category tree, prices in Jita, Amarr, Dodixie, Rens and Hek, the order book and 90-day history.',
      items: ['<b>Arbitrage between hubs</b> walked through the real order books, with a cargo hold field: the profit of one trip and the best load', 'Loot appraisal, LP store, your orders with outbid detection, price alerts', '<b>My trades</b>: real profit per item from your wallet'],
      img: 'screenshots/arbitrage.png',
      alt: 'Arbitrage between trade hubs'
    },
    {
      title: 'Industry',
      text: 'Manufacturing and reaction calculator with ME and TE, engineering complexes and refineries, rigs by system security, the system cost index and taxes.',
      items: ['<b>Production chain</b>: everything an item takes, build or buy at each step, with a Multibuy list', '<b>Invention</b> with every decryptor compared; <b>ore for minerals</b>', 'Corporation structures and moon mining (opt-in)'],
      img: 'screenshots/production-chain.png',
      alt: 'Production chain'
    },
    {
      title: 'Planetary industry',
      text: 'A PI calculator and colony finder, your colonies with extractor timers, and income netted across all of them.',
      img: 'screenshots/pi-colonies.png',
      alt: 'Planetary colonies'
    }
  ]
})

files['character.html'] = featurePage({
  file: 'character.html',
  title: 'Characters',
  eyebrow: 'All your pilots',
  image: 'screenshots/overview.png',
  description:
    'Every EVE Online character on one screen: skill queue and planner with remaps, assets with Jita value, wallet by day, net worth, blueprints, doctrines, mail, fleet and notifications.',
  lead: 'Where every character is and in what, their skill queues, ISK, industry, PI, jump fatigue and clone jumps — on one screen.',
  sections: [
    {
      title: 'Overview',
      text: 'Skill queue and a <b>skill planner</b> with the best remap or two remaps along a long plan, attributes with implants, jump clones, assets with Jita valuation, contracts, loyalty points and standings.',
      items: ['<b>Net worth</b> and the <b>wallet day by day</b> with CSV export', '<b>Blueprint library</b> across all characters', '<b>Doctrines</b>: who can fly each fit and how long the rest need to train'],
      img: 'screenshots/overview.png',
      alt: 'Character overview'
    },
    {
      title: 'Wallet and notifications',
      text: 'Tray and desktop notifications for every character: skill queue running out, PI extractors, finished industry jobs, jump fatigue, outbid market orders, jump clone ready.',
      items: ['Contacts, calendar, EVE mail and fleet management', 'Streaming widgets for OBS: your ship, the current system (optionally delayed), the session’s ISK and a killfeed'],
      img: 'screenshots/wallet.png',
      alt: 'Wallet by day'
    }
  ]
})

files['assistant.html'] = featurePage({
  file: 'assistant.html',
  title: 'AI assistant',
  eyebrow: 'Optional',
  description:
    'An optional AI chat in Canopus that answers EVE Online questions from your own data: fits computed with the same engine, skills, routes and market, plus a local knowledge base of the EVE University wiki.',
  lead: 'A chat panel (<b>Ctrl+J</b>) that answers from Canopus’ own data instead of guessing. It is off until you set it up.',
  sections: [
    {
      title: 'Answers from your data',
      text: 'It looks at your characters, skills, current ship fit, assets, wallet and trades, computes fits with the same engine as the fitting tool, compares ships by how fast they clear a faction’s mission rooms, plans skills, checks routes for recent kills, and opens fits and sections for you.',
      items: [
        'For mechanics, missions and patch changes it searches a local knowledge base: the EVE University wiki and CCP’s patch notes, downloaded to your computer',
        'The web only when that isn’t enough, citing its sources',
        'Actions in the game client (setting a destination, saving a fit) always ask you first'
      ],
    },
    {
      title: 'Your plan or your key',
      text: [
        'It runs on OpenAI: <b>sign in with ChatGPT</b> (Plus or Pro — your plan pays, no separate bill) or use your own API key.',
        'The questions you ask and the data the assistant fetches to answer them (fits, skills, prices, wallet, assets) are sent to OpenAI; your EVE login tokens and passwords never are.'
      ],
    }
  ]
})

// ---------------------------------------------------------------- FAQ
const faq = [
  [
    'fair-play',
    'Is Canopus allowed by CCP? Can I be banned?',
    [
      'Canopus only uses official and player-visible data: CCP’s ESI and static game data, the chat and game logs the client writes to your Documents folder, and what you copy to the clipboard yourself. It never reads the game client’s memory and never automates input — the same approach as Pyfa or RIFT.',
      'The multi-client previews show client windows the way the operating system’s window switcher does and only bring a window to the front; no keys or clicks are sent to the game. CCP publishes no list of approved tools, so as with any third-party tool you use it at your own risk.'
    ]
  ],
  ['free', 'Is it really free?', ['Yes: no ads, no subscriptions, no paid features. If you like Canopus you can send ISK to the author in game — completely voluntary.']],
  [
    'smartscreen',
    'Windows says “Windows protected your PC”. Is it safe?',
    [
      'The Windows builds are not code-signed yet, so SmartScreen warns on first launch: click <b>More info → Run anyway</b>.',
      'Every release lists the SHA-256 checksum of each file with a VirusTotal link, and the Windows and Linux builds are made by GitHub Actions from the public source, so anyone can see how they were built.'
    ]
  ],
  [
    'login',
    'Is logging in with my EVE account safe?',
    [
      'Canopus uses CCP’s own EVE SSO. The login page opens in your own browser, where you can check the login.eveonline.com address; Canopus never sees the page or your password.',
      'Tokens are stored encrypted (Windows DPAPI, the macOS Keychain or the Linux keyring) and never leave your computer. Each permission and why it is needed is listed in the <a href="' +
        REPO +
        '#readme">README</a>; in-game actions and corporation data are asked for only when you turn them on.'
    ]
  ],
  ['data', 'Does Canopus send my data anywhere?', ['Nothing is sent to the developer. Canopus talks to CCP and the public EVE services it shows data from. See <a href="privacy.html">Privacy</a> for the full list.']],
  ['updates', 'How does it update?', ['The Windows, macOS and AppImage builds check GitHub for new versions, download them in the background, verify them by SHA-256 and install on restart. This can be turned off in <b>Settings → Updates</b>. The .deb is updated from the release page.']],
  [
    'pyfa',
    'How accurate is the fitting tool compared to Pyfa?',
    ['The engine was checked against Pyfa 2.69.3 on 44 fits with no differences. You can import all your Pyfa fits at once: several EFT fits or Pyfa’s XML file, mutated modules included.']
  ],
  ['intel-setup', 'How do I set up intel?', ['Run EVE windowed or borderless. Copy Local with <b>Ctrl+A, Ctrl+C</b> (Cmd on a Mac) and Canopus checks everyone automatically. For intel channels, pick them in <b>Intel → Settings</b>; the channels must be open in the game so the client writes their logs.']],
  ['linux', 'Does it work on Linux with Proton or Wine?', ['Yes. Canopus finds the chat logs of EVE running under Steam’s Proton or Wine automatically; for another location set the folder in <b>Intel → Settings</b>.']],
  ['language', 'Which languages?', ['English and Russian — the interface and item names. Switch in <b>Settings → Language</b>.']],
  ['first-start', 'Why does the first start take a while?', ['On first start Canopus downloads CCP’s static game data and builds a local database (about 100 MB). It does this again only when CCP publishes a new build.']],
  ['iphone', 'Is there a phone version?', ['Yes, a separate app for iPhone and iPad: <a href="' + APP_STORE + '">Canopus for EVE Online</a> on the App Store. It is a different app from the desktop one.']],
  ['bugs', 'I found a bug or a wrong number.', ['Report it in <a href="' + REPO + '/issues">Issues</a> — also from <b>Settings → Help and feedback</b> in the app. Questions and ideas go to <a href="' + REPO + '/discussions">Discussions</a>.']]
]
files['faq.html'] = page({
  file: 'faq.html',
  title: 'Frequently asked questions',
  description: 'Is Canopus allowed by CCP, is it free, is the login safe, how it updates, how accurate the fitting is, and more.',
  body: `<section class="hero">
  <div class="wrap" style="grid-template-columns: 1fr">
    <div><div class="eyebrow">FAQ</div><h1>Questions and answers</h1></div>
  </div>
</section>
<section class="block" style="border-top: 0; padding-top: 0">
  <div class="wrap"><div class="prose">
${faq.map(([id, q, a]) => `    <details class="faq" id="${id}"><summary>${q}</summary><div>${a.map((p) => `<p>${p}</p>`).join('')}</div></details>`).join('\n')}
  </div></div>
</section>
${cta()}`
})

// ---------------------------------------------------------------- changelog, privacy, 404
files['changelog.html'] = page({
  file: 'changelog.html',
  title: 'What’s new',
  description: 'Every Canopus release and what it brought.',
  body: `<section class="hero">
  <div class="wrap" style="grid-template-columns: 1fr">
    <div><div class="eyebrow">Releases</div><h1>What’s new</h1><p class="lead">Canopus updates itself; this is what each version brought.</p></div>
  </div>
</section>
<section class="block" style="border-top: 0; padding-top: 0">
  <div class="wrap"><div class="prose" id="changelog"><p class="notice">Loading releases… If nothing appears, see <a href="${REPO}/releases">releases on GitHub</a>.</p></div></div>
</section>`
})

files['privacy.html'] = page({
  file: 'privacy.html',
  title: 'Privacy',
  description: 'What Canopus stores, where it connects, and what is never sent.',
  body: `<section class="hero">
  <div class="wrap" style="grid-template-columns: 1fr">
    <div><div class="eyebrow">Privacy</div><h1>Your data stays on your computer</h1><p class="lead">Canopus has no accounts, no telemetry and no server of its own. Nothing is sent to the developer.</p></div>
  </div>
</section>
<section class="block" style="border-top: 0; padding-top: 0">
  <div class="wrap"><div class="prose">
    <h2>What Canopus stores</h2>
    <p>Everything is stored on your computer: settings, saved fits, notes, game data and caches. EVE login tokens are encrypted with the system’s own protection (Windows DPAPI, the macOS Keychain or the Linux keyring) and never leave your computer.</p>
    <h2>Where Canopus connects</h2>
    <table>
      <tr><th>Service</th><th>What for</th></tr>
      <tr><td>CCP: EVE SSO, ESI, image server, static data</td><td>Login, your characters’ data (only the permissions you granted), game data and icons</td></tr>
      <tr><td>zKillboard</td><td>Kills, pilot statistics, popular fits, kill radar</td></tr>
      <tr><td>EVE-Scout</td><td>Thera and Turnur connections</td></tr>
      <tr><td>Fuzzwork Market</td><td>Market prices</td></tr>
      <tr><td>GitHub</td><td>Checking for and downloading updates (can be turned off)</td></tr>
      <tr><td>OpenAI — only if you set up the assistant</td><td>Your questions and the data the assistant fetches to answer them; never your EVE tokens or passwords</td></tr>
      <tr><td>EVE University wiki, CCP news — only for the assistant</td><td>Downloading the local knowledge base</td></tr>
      <tr><td>Discord — only if you add a webhook</td><td>Posting your intel and price alerts to your channel</td></tr>
    </table>
    <h2>This website</h2>
    <p>The site is hosted on GitHub Pages; GitHub may log visits as described in its privacy statement. To show the latest version and the list of changes, your browser asks GitHub’s public API about releases. The site uses no cookies, analytics or trackers, and its fonts are served from the site itself.</p>
    <h2>Questions</h2>
    <p>Ask in <a href="${REPO}/discussions">Discussions</a>.</p>
  </div></div>
</section>`
})

files['404.html'] = page({
  file: '404.html',
  title: 'Page not found',
  description: 'This page does not exist.',
  body: `<section class="hero">
  <div class="wrap" style="grid-template-columns: 1fr">
    <div><div class="eyebrow">404</div><h1>Lost in space</h1><p class="lead">There is no page here. Warp back to the <a href="./">home page</a> or <a href="download.html">download Canopus</a>.</p></div>
  </div>
</section>`
}).replace(/(href|src)="(?!https?:|#|\/)([^"]+)"/g, (m, attr, path) => `${attr}="${BASE}${path === './' ? '' : path}"`)

// ---------------------------------------------------------------- write
for (const [name, html] of Object.entries(files)) writeFileSync(join(OUT, name), html)
const indexed = Object.keys(files).filter((f) => f !== '404.html')
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...indexed, 'trailer.html']
    .map((f) => `  <url><loc>${SITE}${f === 'index.html' ? '' : f}</loc></url>`)
    .join('\n')}\n</urlset>\n`
)
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`)
console.log(`site: ${indexed.length + 1} pages written to docs/`)
