import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // This example sits inside the elah monorepo but is NOT part of its workspace,
  // so Next sees two lockfiles and guesses the repo root. Pinning both roots to
  // this directory keeps module resolution and output tracing local.
  // You do not need either line in a standalone app with a single lockfile.
  turbopack: { root: here },
  outputFileTracingRoot: here,

  // @elah/editor (and its @elah/core / @elah/react / @elah/timeline deps) plus
  // mediabunny ship modern ESM that must be transpiled by the consuming app.
  // This also lets Turbopack/webpack resolve the export Web Worker that
  // @elah/core spawns via `new Worker(new URL('./ExportWorker.js', import.meta.url))`
  // and emit it as its own chunk.
  //
  // Required — without it the build fails on the @elah/editor barrel.
  transpilePackages: ['@elah/editor', '@elah/core', '@elah/react', '@elah/timeline', 'mediabunny'],
}

export default nextConfig
