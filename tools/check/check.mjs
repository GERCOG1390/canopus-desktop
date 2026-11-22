// The release gate: everything a build must pass before it is released. On success it stamps the commit
// (.release/checked-<sha>); tools/check/stamped.mjs refuses to go on with a commit that has no stamp.
//
//   npm run check            the whole gate (a clean working tree is required for the stamp)
//   npm run check -- --dirty run it on uncommitted work too (no stamp)
//   npm run check -- --quick types, unit tests and golden figures only (no build, no smoke run)
//
// Steps: types, unit tests, golden figures of the engine and the simulator, the app build, and the smoke run
// (every screen in English on a test profile: console errors, error boxes, untranslated text, a contact sheet).

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const dirty = args.includes('--dirty')
const quick = args.includes('--quick')
const git = (...a) => execFileSync(process.platform === 'darwin' ? '/usr/bin/git' : 'git', a, { cwd: root, encoding: 'utf8' }).trim()
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const work = mkdtempSync(join(tmpdir(), 'canopus-check-'))
let step = 0
const total = quick ? 4 : 6

function run(title, cmd, cmdArgs, opts = {}) {
  step++
  console.log(`\n=== ${step}/${total} ${title} ===`)
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, ...opts.env }, shell: process.platform === 'win32' })
  if (opts.capture) process.stdout.write(opts.capture(r.stdout ?? '', r.stderr ?? ''))
  if (r.status !== 0) {
    console.log(`\nCHECK FAILED at "${title}"${opts.log ? ` (log: ${opts.log})` : ''}`)
    process.exit(1)
  }
}

// ---------- 1. A commit to stamp ----------
step++
console.log(`\n=== ${step}/${total} Working tree ===`)
const head = git('rev-parse', '--short', 'HEAD')
const changes = git('status', '--porcelain')
if (changes && !dirty) {
  console.log('Uncommitted changes: commit first (the stamp is for a commit), or run with --dirty to check work in progress.')
  console.log(changes)
  process.exit(1)
}
console.log(changes ? `${head} with uncommitted changes (no stamp)` : head)

// ---------- 2. Types, unit tests, golden figures ----------
run('Types', npm, ['run', '-s', 'typecheck'])
run('Unit tests', npm, ['test', '--silent'], {
  capture: (out, err) => {
    const all = out + err
    const failed = all.split('\n').filter((l) => /^not ok|✖/.test(l))
    return `${failed.join('\n')}${failed.length ? '\n' : ''}${all.split('\n').filter((l) => /^ℹ (tests|pass|fail)/.test(l)).join('\n')}\n`
  }
})
run('Golden figures (engine and simulator on the real SDE)', process.execPath, [join(root, 'tools/check/golden.mjs')])

if (!quick) {
  // ---------- 3. Build ----------
  const buildLog = join(work, 'build.log')
  run('App build', npx, ['electron-vite', 'build'], {
    log: buildLog,
    capture: (out, err) => {
      writeFileSync(buildLog, out + err)
      return /error/i.test(err) ? err.split('\n').filter((l) => /error/i.test(l)).slice(0, 10).join('\n') + '\n' : 'built\n'
    }
  })

  // ---------- 4. Every screen ----------
  const profile = join(work, 'profile')
  const shots = join(work, 'smoke')
  mkdirSync(join(profile, 'sde'), { recursive: true })
  const sde = newestSde()
  for (const f of [`sde-${sde.build}.json`, `sde-${sde.build}-descriptions.json`]) {
    if (!existsSync(join(sde.dir, f))) continue
    try {
      symlinkSync(join(sde.dir, f), join(profile, 'sde', f))
    } catch {
      copyFileSync(join(sde.dir, f), join(profile, 'sde', f))
    }
  }
  const env = { CANOPUS_USER_DATA: profile, CANOPUS_SMOKE: shots }
  delete process.env.ELECTRON_RUN_AS_NODE
  run('Every screen (English, test profile)', npx, ['electron-vite', 'preview', '--skipBuild'], {
    env,
    capture: (out) => {
      const at = out.indexOf('SMOKE ')
      return (at >= 0 ? out.slice(at) : out.slice(-2000)) + `\nContact sheet: ${join(shots, 'sheet.png')}\n`
    }
  })
  rmSync(profile, { recursive: true, force: true })
}

if (changes) {
  console.log(`\nCHECK PASSED for work in progress on ${head} (not stamped: commit, then run it again).`)
} else {
  mkdirSync(join(root, '.release'), { recursive: true })
  writeFileSync(join(root, '.release', `checked-${head}`), `${new Date().toISOString()}${quick ? ' quick' : ''}\n`)
  console.log(`\nCHECK PASSED for ${head}${quick ? ' (quick: no build, no smoke run — not enough for a release)' : ''}`)
}

function newestSde() {
  const dirs = [join(homedir(), 'Library/Application Support/canopus/sde'), join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'canopus/sde'), join(homedir(), '.config/canopus/sde')]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const builds = readdirSync(dir)
      .map((f) => /^sde-(\d+)\.json$/.exec(f)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => b - a)
    if (builds.length) return { dir, build: builds[0] }
  }
  console.log('No SDE found: open Canopus once so it builds one.')
  process.exit(1)
}
