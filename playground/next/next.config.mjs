/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
