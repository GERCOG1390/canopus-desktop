// Canopus website: mobile menu, "download for your system" from the latest GitHub release, changelog.

const REPO = 'GERCOG1390/canopus-desktop'
const RELEASES = `https://github.com/${REPO}/releases/latest`

document.querySelector('.menu-toggle')?.addEventListener('click', (e) => {
  const nav = document.querySelector('.nav')
  const open = nav.classList.toggle('open')
  e.currentTarget.setAttribute('aria-expanded', String(open))
})

/** 'windows' | 'mac' | 'linux' | 'ios' | null */
function detectOs() {
  const ua = navigator.userAgent
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Win/i.test(platform) || /Windows/.test(ua)) return 'windows'
  if (/Mac/i.test(platform) || /Mac OS X/.test(ua)) return 'mac'
  if (/Android/.test(ua)) return null
  if (/Linux|X11/i.test(platform) || /Linux/.test(ua)) return 'linux'
  return null
}

const OS_LABEL = { windows: 'Windows', mac: 'macOS', linux: 'Linux', ios: 'iPhone & iPad' }
const APP_STORE = 'https://apps.apple.com/us/app/canopus-for-eve-online/id6829985678'

const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`

/** Which file each platform gets, by its name in the release. */
const PICK = {
  windows: [
    [/Setup-.*\.exe$/, 'Installer'],
    [/portable\.exe$/, 'Portable, no installation']
  ],
  mac: [[/mac\.dmg$/, 'Disk image (Apple Silicon and Intel)']],
  linux: [
    [/\.AppImage$/, 'AppImage (any distribution)'],
    [/\.deb$/, 'Debian / Ubuntu package']
  ]
}

async function latestRelease() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('canopus.release') || 'null')
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.release
  } catch {}
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(String(res.status))
  const release = await res.json()
  try {
    sessionStorage.setItem('canopus.release', JSON.stringify({ at: Date.now(), release }))
  } catch {}
  return release
}

async function setupDownloads() {
  const os = detectOs()
  const primary = document.querySelectorAll('[data-download-primary]')
  // The fallback in the HTML already points to the releases page / App Store.
  if (os === 'ios') {
    primary.forEach((a) => {
      a.href = APP_STORE
      a.textContent = 'Get it on the App Store'
    })
  }
  document.querySelectorAll('.dl[data-os]').forEach((card) => card.classList.toggle('mine', card.dataset.os === os))

  let release
  try {
    release = await latestRelease()
  } catch {
    return
  }
  const version = release.tag_name.replace(/^v/, '')
  document.querySelectorAll('[data-version]').forEach((el) => (el.textContent = version))
  const assets = release.assets || []
  const find = (re) => assets.find((a) => re.test(a.name))

  for (const [platform, picks] of Object.entries(PICK)) {
    const list = document.querySelector(`.dl[data-os="${platform}"] .files`)
    if (!list) continue
    const links = picks
      .map(([re, label]) => {
        const a = find(re)
        return a ? `<a href="${a.browser_download_url}"><span>${label}</span><small>${mb(a.size)}</small></a>` : ''
      })
      .join('')
    if (links) list.innerHTML = links
  }

  if (os && os !== 'ios' && PICK[os]) {
    const main = find(PICK[os][0][0])
    if (main) {
      primary.forEach((a) => {
        a.href = main.browser_download_url
        a.textContent = `Download for ${OS_LABEL[os]}`
      })
      document.querySelectorAll('[data-download-note]').forEach((el) => {
        const others = /download(\.html)?$/.test(location.pathname) ? '#systems' : 'download.html'
        el.innerHTML = `Version <span class="version">${version}</span> · ${mb(main.size)} · <a href="${others}">other systems</a>`
      })
    }
  }
}

/** Release notes as simple Markdown: headings, lists, bold, links, code. Text is escaped first. */
function markdown(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
  const out = []
  let list = false
  const lines = md.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    const item = line.match(/^\s*[-*]\s+(.*)/)
    if (item) {
      if (!list) out.push('<ul>')
      list = true
      out.push(`<li>${inline(item[1])}</li>`)
      return
    }
    if (list) {
      out.push('</ul>')
      list = false
    }
    if (/^\s*\|/.test(line) || !line.trim()) return
    const h = line.match(/^(#+)\s+(.*)/)
    if (h) out.push(`<h${Math.min(4, h[1].length + 1)}>${inline(h[2])}</h${Math.min(4, h[1].length + 1)}>`)
    // A short line right above a list is that list's heading ("Combat simulator").
    else if (line.length <= 48 && !/[.:!?]$/.test(line) && /^\s*[-*]\s+/.test(lines[i + 1] || '')) out.push(`<h4>${inline(line)}</h4>`)
    else out.push(`<p>${inline(line)}</p>`)
  })
  if (list) out.push('</ul>')
  return out.join('\n')
}

async function setupChangelog() {
  const box = document.getElementById('changelog')
  if (!box) return
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(String(res.status))
    const releases = (await res.json()).filter((r) => !r.draft && !r.prerelease)
    // English part only: the notes repeat the title, then English, Russian, downloads and checksums.
    const strip = (body) =>
      (body || '')
        .split(/\r?\n\s*\*\*Русский\*\*|\r?\n#+\s*(Download|Checksums|Verify|SHA-?256)/i)[0]
        .replace(/^\s*#+\s*Canopus[^\n]*\n/, '')
        .replace(/^\s*\*\*English\*\*\s*$/m, '')
    box.innerHTML = releases
      .map((r, i) => {
        const version = r.tag_name.replace(/^v/, '').replace(/[<>&"]/g, '')
        const major = /\.0$/.test(version) ? ' major' : ''
        return `<article class="release${major}${i === 0 ? ' latest' : ''}" id="v${version}">
  <header class="release-head">
    <h2><a href="#v${version}">${version}</a></h2>
    ${i === 0 ? '<span class="release-tag">Latest</span>' : ''}
    <div class="date">${new Date(r.published_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}<br /><a href="${r.html_url}">on GitHub</a></div>
  </header>
  <div class="body">${markdown(strip(r.body))}</div>
</article>`
      })
      .join('')
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  } catch {
    box.innerHTML = `<p class="notice">The list of changes couldn't be loaded right now. All releases are on <a href="https://github.com/${REPO}/releases">GitHub</a>.</p>`
  }
}


/** The home page's starfield: three depths drifting slowly, a few stars twinkling, a little parallax
 *  with the pointer. Drawn once and still with reduced motion; paused when off screen or in a hidden tab. */
function setupStars() {
  const canvas = document.querySelector('canvas.stars')
  if (!canvas || !canvas.getContext) return
  const ctx = canvas.getContext('2d')
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  // Seeded, so the sky is the same on every visit.
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const layers = [
    { n: 150, size: 0.6, speed: 2, alpha: 0.45, depth: 4 },
    { n: 70, size: 0.95, speed: 5, alpha: 0.65, depth: 10 },
    { n: 22, size: 1.4, speed: 9, alpha: 0.9, depth: 20 }
  ]
  const stars = layers.flatMap((l) =>
    Array.from({ length: l.n }, () => ({
      l,
      x: rnd(),
      y: rnd(),
      r: l.size * (0.7 + rnd() * 0.6),
      tw: rnd() < 0.25 ? 0.6 + rnd() * 1.6 : 0,
      ph: rnd() * Math.PI * 2,
      // Mostly white, some warm like the mark, some cool like the accent.
      c: rnd() < 0.12 ? '255,217,138' : rnd() < 0.15 ? '143,224,200' : '230,236,245'
    }))
  )
  let w = 0, h = 0, dpr = 1
  const size = () => {
    dpr = Math.min(2, devicePixelRatio || 1)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  let px = 0, py = 0, tx = 0, ty = 0
  const draw = (t) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    px += (tx - px) * 0.04
    py += (ty - py) * 0.04
    for (const s of stars) {
      const x = (((s.x * w - (t / 1000) * s.l.speed + px * s.l.depth) % w) + w) % w
      const y = (((s.y * h + py * s.l.depth) % h) + h) % h
      const a = s.l.alpha * (s.tw ? 0.55 + 0.45 * Math.sin((t / 1000) * s.tw + s.ph) : 1)
      ctx.fillStyle = `rgba(${s.c},${a.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, y, s.r, 0, Math.PI * 2)
      ctx.fill()
      if (s.r > 1.5 && a > 0.75) {
        ctx.fillStyle = `rgba(${s.c},${(a * 0.12).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, s.r * 3.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  size()
  addEventListener('resize', () => {
    size()
    if (still) draw(0)
  })
  if (still) return draw(0)
  addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth - 0.5) * -1
    ty = (e.clientY / innerHeight - 0.5) * -1
  }, { passive: true })
  let visible = true, frame = 0
  const loop = (t) => {
    frame = 0
    if (!visible || document.hidden) return
    draw(t)
    frame = requestAnimationFrame(loop)
  }
  const start = () => {
    if (!frame && visible && !document.hidden) frame = requestAnimationFrame(loop)
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    start()
  }).observe(canvas)
  document.addEventListener('visibilitychange', start)
  start()
}

/** Short clips play only while on screen; with reduced motion they stay on their poster, with controls to play. */
function setupClips() {
  const clips = document.querySelectorAll('video.clip')
  if (!clips.length) return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    clips.forEach((v) => (v.controls = true))
    return
  }
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.preload = 'auto'
          e.target.play().catch(() => (e.target.controls = true))
        } else e.target.pause()
      }
    },
    { threshold: 0.25 }
  )
  clips.forEach((v) => seen.observe(v))
}

void setupClips()
void setupStars()
void setupDownloads()
void setupChangelog()
