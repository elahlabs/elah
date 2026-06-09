/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @elah/editor (and its @elah/core / @elah/timeline deps) plus mediabunny
  // ship modern ESM that must be transpiled by the consuming app. This also
  // lets the bundler resolve the export Web Worker that @elah/core spawns via
  // `new Worker(new URL('./ExportWorker.js', import.meta.url))`.
  transpilePackages: ['@elah/editor', '@elah/core', '@elah/timeline', 'mediabunny'],
}

export default nextConfig
