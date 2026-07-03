// Workaround for a bug in the published @elah/core dist (as of 0.3.0):
// `exportVideo.js` spawns the MP4 export worker with
//   new Worker(new URL('./ExportWorker.ts', import.meta.url), …)
// but the package only ships the compiled `./ExportWorker.js`, so the `.ts`
// specifier is unresolvable and any consumer bundler (Turbopack, webpack, Vite)
// fails to build — even the page's first load, since the editor barrel pulls
// exportVideo into the module graph.
//
// The real worker file (`ExportWorker.js`) sits right next to exportVideo.js, so
// we just rewrite the one bad string in our installed copy. Runs on postinstall;
// idempotent and a no-op once the SDK ships a fixed dist.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '../node_modules/@elah/core/dist/export/exportVideo.js')

if (!existsSync(target)) {
  // Nothing to patch (deps not installed yet / different layout) — stay quiet.
  process.exit(0)
}

const BAD = "new URL('./ExportWorker.ts', import.meta.url)"
const GOOD = "new URL('./ExportWorker.js', import.meta.url)"

const src = readFileSync(target, 'utf8')
if (!src.includes(BAD)) {
  // Already correct (patched, or SDK fixed upstream).
  process.exit(0)
}

writeFileSync(target, src.replaceAll(BAD, GOOD))
console.log('[patch-elah-worker] rewrote ExportWorker.ts → ExportWorker.js in @elah/core dist')
