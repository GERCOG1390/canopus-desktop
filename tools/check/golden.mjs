// Bundles tools/check/golden-entry.ts with the engine (esbuild, which electron-vite already brings) and runs it.
//   npm run golden             compare with tests/golden/expected.json
//   npm run golden -- --update record the current figures

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const shim = join(here, 'golden-shim.ts')
const out = join(mkdtempSync(join(tmpdir(), 'canopus-golden-')), 'golden.mjs')

await build({
  entryPoints: [join(here, 'golden-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  logLevel: 'error',
  plugins: [
    {
      name: 'main-process-shim',
      setup(b) {
        // The engine's links to the running app: its SDE and its fit store.
        b.onResolve({ filter: /^(\.\/index|\.\.\/sde)$/ }, (args) => (args.importer.includes(join('src', 'main', 'dogma')) ? { path: shim } : undefined))
      }
    }
  ]
})

const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, CANOPUS_ROOT: root } })
process.exit(r.status ?? 1)
