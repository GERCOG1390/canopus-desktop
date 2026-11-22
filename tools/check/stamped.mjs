// Refuses to go on with a commit that hasn't passed `npm run check` (the full gate, not --quick).
//   node tools/check/stamped.mjs [tag or commit]   (default HEAD)
// Release steps call it first: a build is only made from a checked commit.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ref = process.argv[2] ?? 'HEAD'
const sha = execFileSync(process.platform === 'darwin' ? '/usr/bin/git' : 'git', ['rev-parse', '--short', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim()
const stamp = join(root, '.release', `checked-${sha}`)
if (!existsSync(stamp)) {
  console.log(`${ref} (${sha}) has not passed npm run check: run it on that commit first.`)
  process.exit(1)
}
if (readFileSync(stamp, 'utf8').includes('quick')) {
  console.log(`${ref} (${sha}) passed only the quick check: run the full npm run check for a release.`)
  process.exit(1)
}
console.log(`${ref} (${sha}) checked: ${readFileSync(stamp, 'utf8').trim()}`)
