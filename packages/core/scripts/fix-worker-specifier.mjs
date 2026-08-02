// Rewrites the export worker specifier in the emitted dist.
//
// `exportVideo.ts` spawns the MP4 export worker with
//   new Worker(new URL('./ExportWorker.ts', import.meta.url), { type: 'module' })
//
// The `.ts` specifier is correct *in source*: apps/web aliases `@elah/*` to
// `packages/*/src/index.ts` (see apps/web/next.config.mjs), so the bundler must
// find the real TypeScript file sitting next to exportVideo.ts.
//
// But `tsc` copies the string literal verbatim, and the published package ships
// only the compiled `ExportWorker.js`. Consumers installing from npm would get an
// unresolvable specifier and their bundler (Turbopack, webpack, Vite) would fail
// on the editor barrel — before the page even renders.
//
// So we fix it exactly once, here, after tsc. Consumers need no workaround.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '../dist/export/exportVideo.js')

const BAD = "new URL('./ExportWorker.ts', import.meta.url)"
const GOOD = "new URL('./ExportWorker.js', import.meta.url)"

const fail = (msg) => {
  console.error(`[fix-worker-specifier] ${msg}`)
  process.exit(1)
}

if (!existsSync(target)) fail(`missing build output: ${target}`)

const src = readFileSync(target, 'utf8')

// Guard, not a no-op: if the specifier is neither the expected `.ts` form nor
// already `.js`, exportVideo was refactored and this script silently stopped
// protecting consumers. Break the build instead.
if (!src.includes(BAD)) {
  if (src.includes(GOOD)) {
    console.log('[fix-worker-specifier] already .js — nothing to do')
    process.exit(0)
  }
  fail(
    'could not find the ExportWorker specifier in dist/export/exportVideo.js.\n' +
      '  The worker spawn was refactored — update this script (and check that the\n' +
      '  published dist still resolves ExportWorker.js) before releasing.',
  )
}

writeFileSync(target, src.replaceAll(BAD, GOOD))
console.log('[fix-worker-specifier] rewrote ExportWorker.ts → ExportWorker.js')
