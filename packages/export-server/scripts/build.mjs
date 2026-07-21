#!/usr/bin/env node
import { build } from 'esbuild'

// Bundling (rather than tsc emit like core) is load-bearing: @elah/core's dist
// uses extensionless relative imports (bundler resolution), which plain Node
// cannot resolve. esbuild resolves them at build time and tree-shakes core's
// browser-only modules out of the Node bundle.
//
// @napi-rs/canvas stays external because it is a native addon — bundling it
// would detach the JS wrapper from its platform-specific .node binary.
// mediabunny stays external so the host resolves the same copy core does.
await build({
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  external: ['@napi-rs/canvas', 'mediabunny'],
  logLevel: 'info',
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
})
