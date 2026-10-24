/**
 * Build the Elah artifact app into `artifact/dist/` (plan PLAN-CLAUDE-PLUGIN-ARTIFACT section 4).
 *
 *   node artifact/build.mjs        (run from the elah repo root; nothing is installed)
 *
 * esbuild and the Tailwind CLI are resolved from the repo's existing node_modules (the way
 * scripts/measure-bundle.mjs does). `@elah/*` is aliased to `packages/*\/src`, `@/` to `apps/web`,
 * so the page is built from source and never depends on a stale `dist/`.
 *
 * Workers: core spawns three workers with `new Worker(new URL('./X.ts', import.meta.url))`, a pattern
 * esbuild does not follow. The workers are built as their own ESM entries into `dist/workers/`, and a
 * load-time rewrite points each spawn at `workers/X.js` next to the entry (works from the entry file
 * and from a `chunks/` file alike). Every URL is the page's own origin.
 */
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ART = join(ROOT, 'artifact')
const DIST = join(ART, 'dist')
const CACHE = join(ART, '.cache')
const WEB = join(ROOT, 'apps/web')
const require = createRequire(join(ROOT, 'packages/cli/package.json'))
const esbuild = require('esbuild')

const MAX_FILES = 250
const MAX_FILE_BYTES = 16 * 1024 * 1024

const fail = (msg) => {
  console.error(`build failed: ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

const CORE_SUBPATHS = {
  '': 'index.ts',
  engine: 'engine.ts',
  spec: 'spec/index.ts',
  html: 'vector/html/index.ts',
  ops: 'ops/index.ts',
  icons: 'icons/index.ts',
}

/** `@elah/<pkg>[/<sub>]` and `@/...` resolve to source. */
const sourceAliases = {
  name: 'elah-source-aliases',
  setup(build) {
    build.onResolve({ filter: /^@elah\/(core|editor|timeline|react)(\/.*)?$/ }, (args) => {
      const m = /^@elah\/(core|editor|timeline|react)(?:\/(.*))?$/.exec(args.path)
      const [, pkg, sub = ''] = m
      if (pkg === 'core') {
        const file = CORE_SUBPATHS[sub]
        if (!file) return { errors: [{ text: `Unmapped core subpath: ${args.path}` }] }
        return { path: join(ROOT, 'packages/core/src', file) }
      }
      if (sub) return { errors: [{ text: `Unmapped subpath: ${args.path}` }] }
      return { path: join(ROOT, 'packages', pkg, 'src/index.ts') }
    })
    build.onResolve({ filter: /^@\// }, (args) =>
      build.resolve('./' + args.path.slice(2), { resolveDir: WEB, kind: args.kind }),
    )
  },
}

const WORKER_FILES = /packages[\\/]core[\\/]src[\\/](export[\\/]exportVideo|audio[\\/]analyzeInWorker|media[\\/]runCapabilityProbe)\.ts$/
const WORKER_SPAWN = /new Worker\(\s*new URL\('\.\/([\w.]+)\.ts',\s*import\.meta\.url\)/g

const workerUrlRewrite = {
  name: 'elah-worker-urls',
  setup(build) {
    build.onLoad({ filter: WORKER_FILES }, (args) => {
      const src = readFileSync(args.path, 'utf8')
      let hits = 0
      const out = src.replace(WORKER_SPAWN, (_all, name) => {
        hits++
        return `new Worker(new URL(import.meta.url.replace(/(?:chunks\\/)?[^\\/]*$/, 'workers/${name}.js'))`
      })
      if (hits === 0) return { errors: [{ text: `No worker spawn found to rewrite in ${args.path}` }] }
      return { contents: out, loader: 'ts' }
    })
  },
}

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  // apps/web carries its own React 19; the packages use the root React 18. One copy only.
  alias: {
    react: join(ROOT, 'node_modules/react'),
    'react-dom': join(ROOT, 'node_modules/react-dom'),
  },
  logLevel: 'warning',
  tsconfig: join(ART, 'tsconfig.json'),
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

rmSync(DIST, { recursive: true, force: true })
rmSync(CACHE, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })
mkdirSync(CACHE, { recursive: true })

// 1. Workers (standalone ESM, no splitting: a worker file must be self-contained).
await esbuild.build({
  ...common,
  entryPoints: {
    'workers/ExportWorker': join(ROOT, 'packages/core/src/export/ExportWorker.ts'),
    'workers/analysisWorker': join(ROOT, 'packages/core/src/audio/analysisWorker.ts'),
    'workers/capabilityProbe.worker': join(ROOT, 'packages/core/src/media/capabilityProbe.worker.ts'),
  },
  outdir: DIST,
  plugins: [sourceAliases],
})

// 2. The app: one entry, split chunks (mediabunny and the export module load on first use).
await esbuild.build({
  ...common,
  entryPoints: { 'elah-artifact': join(ART, 'src/main.tsx') },
  outdir: DIST,
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  plugins: [sourceAliases, workerUrlRewrite],
})

// 3. CSS: tokens from the web app's globals (the editor token bridge) + Tailwind over the sources we reuse.
const globals = readFileSync(join(WEB, 'styles/globals.css'), 'utf8')
const tokenStart = globals.indexOf('@elah/editor token bridge')
const tokenEnd = globals.indexOf('/* Syntax highlight overrides */')
if (tokenStart < 0 || tokenEnd < 0) fail('could not find the editor token bridge in apps/web/styles/globals.css')
const tokenBlock = globals.slice(globals.lastIndexOf('/*', tokenStart), tokenEnd)
const appCss = readFileSync(join(ART, 'src/app.css'), 'utf8')
writeFileSync(
  join(CACHE, 'input.css'),
  `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n${tokenBlock}\n${appCss}\n`,
)
const tw = spawnSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/tailwindcss/lib/cli.js'),
    '-c', join(ART, 'tailwind.config.ts'),
    '-i', join(CACHE, 'input.css'),
    '-o', join(CACHE, 'out.css'),
    '--minify',
  ],
  { cwd: ART, encoding: 'utf8' }, // content globs in tailwind.config.ts are relative to this cwd
)
if (tw.status !== 0) fail(`tailwind exited ${tw.status}\n${tw.stdout}\n${tw.stderr}`)
const css = readFileSync(join(CACHE, 'out.css'), 'utf8')

// 4. The page.
const template = readFileSync(join(ART, 'template/index.html'), 'utf8')
if (!template.includes('/*CSS*/')) fail('template/index.html has no /*CSS*/ marker')
writeFileSync(join(DIST, 'index.html'), template.replace('/*CSS*/', () => css))

// 5. Fonts (12 OFL families + their licence files).
cpSync(join(ROOT, 'packages/core/fonts'), join(DIST, 'fonts'), { recursive: true })
rmSync(CACHE, { recursive: true, force: true })

// 6. Manifest + limits.
const files = []
const walk = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(relative(DIST, p).split(sep).join('/'))
  }
}
walk(DIST)
files.sort()
const sizes = Object.fromEntries(files.map((f) => [f, statSync(join(DIST, f)).size]))
const total = Object.values(sizes).reduce((a, b) => a + b, 0)
const [largestName, largestBytes] = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]
if (files.length > MAX_FILES) fail(`${files.length} files exceeds the ${MAX_FILES} file limit`)
if (largestBytes > MAX_FILE_BYTES) fail(`${largestName} is ${largestBytes} bytes, over the 16 MB limit`)
for (const need of ['index.html', 'elah-artifact.js', 'workers/ExportWorker.js']) {
  if (!existsSync(join(DIST, need))) fail(`missing ${need}`)
}
writeFileSync(
  join(DIST, 'MANIFEST.json'),
  JSON.stringify({ format: 'elah-artifact-manifest', version: 1, entry: 'index.html', files, sizes, totalBytes: total }, null, 2) + '\n',
)

const kb = (n) => (n / 1024).toFixed(1) + ' KiB'
console.log(`artifact/dist: ${files.length} files + MANIFEST.json, ${kb(total)} total, largest ${largestName} (${kb(largestBytes)})`)
