/**
 * Measure what `@elah/*` costs a consumer, reproducibly.
 *
 *   node scripts/measure-bundle.mjs        (run `npm run build:packages` first)
 *
 * Three measurements, because they answer different questions (C is the one to
 * quote as "what an app pays"; B is a worst case nobody ships):
 *
 *  A) "dist" — the tsc ESM output exactly as published to npm: raw bytes of
 *     every `dist/**\/*.js`, and the gzip of their concatenation. This is what
 *     `npm pack` ships. It is NOT what a browser downloads: nothing is minified
 *     and nothing is tree-shaken, so it overstates runtime cost badly.
 *
 *  B) "bundle" — the package barrel run through esbuild with `--bundle --minify
 *     --format=esm`, then gzipped. Host-owned libraries (react, react-dom,
 *     lucide-react) are external because the app ships its own copy. This is the
 *     number a consumer should budget for, and the one the README badges quote.
 *
 *  C) "consumer entries" — a one-line module importing only the names an app
 *     uses (the editor app, the engine alone, render + export, and the `spec`
 *     and `html` subpaths on their own), bundled like B so esbuild tree-shakes
 *     the rest. Each row lists its biggest contributors by directory.
 *
 * All are printed so they are never confused again: the 0.2.1 figures in
 * BUNDLE_STRATEGY.md were method A, and the badges presented them as if they
 * were B.
 *
 * mediabunny is shown separately. It is a runtime dependency of @elah/core but
 * every import of it is a dynamic `import()` inside the demuxer and the export
 * worker, so a bundler that code-splits dynamic imports (Vite, webpack, Next)
 * puts it in its own chunk, loaded only when the app first decodes or exports.
 * The "+ mediabunny" row is the cost if a bundler cannot split it.
 *
 * esbuild is resolved from @elah/cli's devDependencies; nothing is installed.
 */
import { createRequire } from 'node:module'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'packages/cli/package.json'))
const esbuild = require('esbuild')

const PKGS = ['core', 'react', 'timeline', 'editor']
const HOST = ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react']
const CODEC = ['mediabunny']
const SMALL = ['immer', 'zustand', 'clsx', 'tailwind-merge']

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (n.endsWith('.js') && !n.endsWith('.test.js')) out.push(p)
  }
  return out
}
const kib = (b) => (b / 1024).toFixed(1).padStart(7) + ' KiB'
const gz = (buf) => gzipSync(buf, { level: 9 }).length

async function bundle(entry, external) {
  const r = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    external,
    loader: { '.css': 'empty' },
  })
  const code = r.outputFiles[0].contents
  return { raw: code.length, gz: gz(code) }
}

console.log('A) tsc dist output, as published to npm (unminified, not tree-shaken)')
let distRaw = 0
let distFiles = []
for (const p of PKGS) {
  const files = walk(join(ROOT, 'packages', p, 'dist'))
  const raw = files.reduce((n, f) => n + statSync(f).size, 0)
  const g = gz(Buffer.concat(files.map((f) => readFileSync(f))))
  distRaw += raw
  distFiles = distFiles.concat(files)
  console.log(`  @elah/${p.padEnd(9)} ${String(files.length).padStart(3)} files  raw ${kib(raw)}  gz ${kib(g)}`)
}
console.log(`  all four        ${String(distFiles.length).padStart(3)} files  raw ${kib(distRaw)}  gz ${kib(gz(Buffer.concat(distFiles.map((f) => readFileSync(f)))))}`)

console.log('\nB) esbuild bundle of each barrel, minified + gzipped (react, react-dom, lucide-react external)')
console.log('   WORST CASE: every name the barrel exports, with tree-shaking defeated by `export *`. No app pays this;')
console.log('   section C below is what a real app pays.')
for (const p of PKGS) {
  const entry = join(ROOT, 'packages', p, 'dist/index.js')
  const others = PKGS.filter((q) => q !== p).map((q) => `@elah/${q}`)
  const own = await bundle(entry, [...HOST, ...others, ...CODEC, ...SMALL])
  const withDeps = await bundle(entry, [...HOST, ...others, ...CODEC])
  console.log(`  @elah/${p.padEnd(9)} own code ${kib(own.gz)} gz  | with its small deps ${kib(withDeps.gz)} gz`)
}

const full = join(ROOT, 'packages/editor/dist/index.js')
const f1 = await bundle(full, [...HOST, ...CODEC, ...SMALL])
const f2 = await bundle(full, [...HOST, ...CODEC])
const f3 = await bundle(full, [...HOST])
console.log('\n   Full SDK, worst case: everything exported (@elah/editor with core + react + timeline bundled in):')
console.log(`  @elah/* code only          ${kib(f1.gz)} gz  (${kib(f1.raw)} raw)`)
console.log(`  + immer, zustand, clsx,    ${kib(f2.gz)} gz  (${kib(f2.raw)} raw)   <- what a browser downloads, codec split out`)
console.log(`    tailwind-merge`)
console.log(`  + mediabunny               ${kib(f3.gz)} gz  (${kib(f3.raw)} raw)   <- only if the bundler cannot code-split the lazy import`)

// C) Consumer entries: what an app pays for the names it actually imports.
//
// Each entry is a one-line module that imports only those names, bundled with
// the same flags as B. esbuild tree-shakes the rest (the packages are
// `sideEffects: false`). react, react-dom, lucide-react and mediabunny are
// external: the app ships its own React and icons, and mediabunny is a lazy
// import that a code-splitting bundler puts in its own chunk. Contributors are
// attributed from esbuild's metafile by package, and by directory inside core.
// The "editor app" row is the startup number the docs quote.
const CONSUMERS = [
  ['editor app (EditorProvider + Preview + Timeline)', "export { EditorProvider, Preview, Timeline } from '@elah/editor'"],
  ['core engine only (TimelineEngine + resolveTimeline)', "export { TimelineEngine, resolveTimeline } from '@elah/core'"],
  ['core render + export (TimelineEngine + GpuRenderer + exportVideo)', "export { TimelineEngine, GpuRenderer, exportVideo } from '@elah/core'"],
  ['@elah/core/spec on its own', "export * from '@elah/core/spec'"],
  ['@elah/core/html on its own', "export * from '@elah/core/html'"],
]
const CONSUMER_EXTERNAL = [...HOST, ...CODEC]
// "Startup" means what a code-splitting bundler (Vite, webpack, Next) downloads
// before first paint. A relative `import('./x')` inside @elah/core is a split
// point there (CONV-8: effects, generators, sequences, roto masks, Enhance load
// on first use), but esbuild without `splitting` would inline it and count it.
// This plugin leaves every relative dynamic import out of the bundle, which is
// the startup graph; each excluded module is listed under "loaded on first use".
const lazyRelativeImports = (collected) => ({
  name: 'lazy-relative-imports',
  setup(b) {
    b.onResolve({ filter: /^\./ }, (args) => {
      if (args.kind !== 'dynamic-import') return undefined
      collected.add(args.path)
      return { path: args.path, external: true }
    })
  },
})
console.log('\nC) consumer entries: what a real app pays (minified + gzipped, react/lucide-react/mediabunny external)')
for (const [name, contents] of CONSUMERS) {
  const lazy = new Set()
  const r = await esbuild.build({
    plugins: [lazyRelativeImports(lazy)],
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
    splitting: false,
    outdir: 'out',
    external: CONSUMER_EXTERNAL,
    logLevel: 'silent',
    loader: { '.css': 'empty' },
  })
  const js = r.outputFiles.find((f) => f.path.endsWith('.js'))
  const out = Object.values(r.metafile.outputs).find((o) => o.inputs)
  const byDir = new Map()
  for (const [file, info] of Object.entries(out.inputs)) {
    const core = file.match(/packages\/core\/dist\/([^/]+)/)
    const pkg = file.match(/packages\/(\w+)\//)
    const key = core ? 'core/' + core[1] : pkg ? 'pkg:' + pkg[1] : 'node_modules'
    byDir.set(key, (byDir.get(key) ?? 0) + info.bytesInOutput)
  }
  console.log(`\n  ${name}`)
  console.log(`    ${kib(gz(js.contents))} gz  (${kib(js.contents.length)} raw)`)
  for (const [k, v] of [...byDir].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`      ${k.padEnd(24)} ${kib(v)} min`)
  }
  if (lazy.size > 0) console.log(`      loaded on first use: ${[...lazy].map((p) => p.replace(/^(\.\.?\/)+/, '')).sort().join(', ')}`)
}

console.log('\nD) the runtime libraries on their own')
for (const lib of [...SMALL, ...CODEC]) {
  const r = await esbuild.build({
    stdin: { contents: `export * from '${lib}'`, resolveDir: ROOT },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  })
  const code = r.outputFiles[0].contents
  console.log(`  ${lib.padEnd(14)} ${kib(gz(code))} gz  (${kib(code.length)} raw)`)
}
