#!/usr/bin/env node
import { build } from 'esbuild'
import { chmodSync } from 'node:fs'

// Bundling (rather than tsc emit like the other packages) is load-bearing:
// @elah/core's dist uses extensionless relative imports (bundler resolution),
// which plain Node cannot resolve. esbuild resolves them at build time and
// tree-shakes core's browser-only modules out of the Node bundle.
await build({
  entryPoints: ['src/bin.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/bin.js',
  external: ['playwright-core'],
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})

chmodSync('dist/bin.js', 0o755)
