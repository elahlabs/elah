// Rewrites the worker specifiers in the emitted dist.
//
// Three modules spawn a module worker with a literal `.ts` specifier:
//   export/exportVideo.ts          new URL('./ExportWorker.ts', import.meta.url)   (two sites)
//   audio/analyzeInWorker.ts       new URL('./analysisWorker.ts', import.meta.url)
//   media/runCapabilityProbe.ts    new URL('./capabilityProbe.worker.ts', import.meta.url)
//
// The `.ts` specifier is correct *in source*: apps/web aliases the core package to
// `packages/core/src/index.ts` (see apps/web/next.config.mjs), so the bundler must
// find the real TypeScript file sitting next to the spawning module.
//
// But `tsc` copies the string literal verbatim, and the published package ships
// only the compiled `.js` workers. Consumers installing from npm would get an
// unresolvable specifier and their bundler (Turbopack, webpack, Vite) would fail
// on the editor barrel, before the page even renders.
//
// So we fix them exactly once, here, after tsc. Consumers need no workaround.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// Each entry: the emitted file and the worker it spawns (without extension).
const TARGETS = [
  { file: 'export/exportVideo.js', worker: './ExportWorker' },
  { file: 'audio/analyzeInWorker.js', worker: './analysisWorker' },
  { file: 'media/runCapabilityProbe.js', worker: './capabilityProbe.worker' },
]

const fail = (msg) => {
  console.error(`[fix-worker-specifier] ${msg}`)
  process.exit(1)
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

for (const { file, worker } of TARGETS) {
  const target = resolve(here, '../dist', file)
  if (!existsSync(target)) fail(`missing build output: ${target}`)

  const src = readFileSync(target, 'utf8')
  const name = worker.replace(/^\.\//, '')

  // `tsc` may keep a call on one line or split it across several, so tolerate
  // whitespace between the tokens.
  const bad = new RegExp(
    `new URL\\(\\s*(['"])${escapeRegExp(worker)}\\.ts\\1(\\s*,\\s*import\\.meta\\.url\\s*\\))`,
    'g',
  )
  const good = new RegExp(
    `new URL\\(\\s*(['"])${escapeRegExp(worker)}\\.js\\1\\s*,\\s*import\\.meta\\.url\\s*\\)`,
  )

  // Guard, not a no-op: if the specifier is neither the expected `.ts` form nor
  // already `.js`, the spawning module was refactored and this script silently
  // stopped protecting consumers. Break the build instead.
  if (!bad.test(src)) {
    if (good.test(src)) {
      console.log(`[fix-worker-specifier] ${file}: already .js, nothing to do`)
      continue
    }
    fail(
      `could not find the ${name} specifier in dist/${file}.\n` +
        '  The worker spawn was refactored: update this script (and check that the\n' +
        `  published dist still resolves ${name}.js) before releasing.`,
    )
  }

  bad.lastIndex = 0
  const next = src.replace(bad, (_m, quote, tail) => `new URL(${quote}${worker}.js${quote}${tail}`)
  writeFileSync(target, next)
  console.log(`[fix-worker-specifier] ${file}: rewrote ${name}.ts to ${name}.js`)
}
