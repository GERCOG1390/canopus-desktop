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
        el.innerHTML = `Version <span class="version">${version}</span> · ${mb(main.size)} · <a href="download.html">other systems</a>`
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
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const item = line.match(/^\s*[-*]\s+(.*)/)
    if (item) {
      if (!list) out.push('<ul>')
      list = true
      out.push(`<li>${inline(item[1])}</li>`)
      continue
    }
    if (list) {
      out.push('</ul>')
      list = false
    }
    if (/^\s*\|/.test(line) || !line.trim()) continue
    const h = line.match(/^(#+)\s+(.*)/)
    if (h) out.push(`<h${Math.min(4, h[1].length + 1)}>${inline(h[2])}</h${Math.min(4, h[1].length + 1)}>`)
    else out.push(`<p>${inline(line)}</p>`)
  }
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
      .map(
        (r) => `<article class="release">
  <h2>${r.name ? r.name.replace(/[<>&]/g, '') : r.tag_name}</h2>
  <div class="date">${new Date(r.published_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })} · <a href="${r.html_url}">on GitHub</a></div>
  <div class="body">${markdown(strip(r.body))}</div>
</article>`
      )
      .join('')
  } catch {
    box.innerHTML = `<p class="notice">The list of changes couldn't be loaded right now. All releases are on <a href="https://github.com/${REPO}/releases">GitHub</a>.</p>`
  }
}

void setupDownloads()
void setupChangelog()
