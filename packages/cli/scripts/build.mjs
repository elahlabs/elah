#!/usr/bin/env node
import { build } from 'esbuild'
import { chmodSync, readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// Bundling (rather than tsc emit like the other packages) is load-bearing:
// @elah/core's dist uses extensionless relative imports (bundler resolution),
// which plain Node cannot resolve. esbuild resolves them at build time and
// tree-shakes core's browser-only modules out of the Node bundle.
const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  external: ['playwright-core'],
  define: { __ELAH_CLI_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
}

await build({
  ...sharedOptions,
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/bin.js',
  banner: { js: '#!/usr/bin/env node' },
})
chmodSync('dist/bin.js', 0o755)

// The library entry — no shebang, no chmod. Deliberately a separate
// self-contained bundle (no esbuild `splitting`) rather than shared chunks
// with bin.js, so each output file stays independently runnable.
await build({
  ...sharedOptions,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
})
