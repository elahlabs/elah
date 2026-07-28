import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

// Next.js only auto-loads .env files from this app's own directory, but the
// repo keeps a single shared .env at the monorepo root. Load it manually
// before anything reads process.env.
try {
  process.loadEnvFile(path.resolve(root, '../../.env'))
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}

const pkgSrcAbs = (name) => path.resolve(root, '../../packages', name, 'src/index.ts')
// Turbopack's resolveAlias can't take an absolute Windows path ("windows imports
// are not implemented yet"), so give it a project-root-relative POSIX path.
const pkgSrcRel = (name) => {
  const rel = path.relative(root, pkgSrcAbs(name)).split(path.sep).join('/')
  return rel.startsWith('.') ? rel : './' + rel
}

// Dev accuracy: resolve the internal @elah/* packages to their TypeScript source
// instead of the prebuilt dist/. Combined with transpilePackages (below), the
// bundler compiles the source directly, so editing any package file triggers
// normal Fast Refresh — no manual rebuild, no stale dist.
//
// Both bundlers are configured because they're used in different phases:
//   - `next dev` (Next 16) uses Turbopack  → turbopack.resolveAlias (relative path)
//   - `next build` (production) uses webpack → config.resolve.alias (absolute path)
// dist/ is left untouched for `npm publish`.
//
// Each alias targets the BARE package specifier only; subpath imports
// (e.g. `@elah/editor/styles.css`) keep resolving through each package's own
// `exports` map. Webpack needs a trailing `$` for that exact match; Turbopack
// treats a key without `*` as an exact match already.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://us-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ]
  },
  async headers() {
    return [
      {
        // updateViaCache: 'none' (ServiceWorkerRegistrar.tsx) bypasses the
        // browser HTTP cache for this file, but a CDN in front of `next
        // start` won't know that — be explicit so it never pins a stale worker.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
  experimental: {
    mdxRs: false,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  transpilePackages: ['@elah/editor', '@elah/core', '@elah/timeline', 'mediabunny'],
  turbopack: {
    resolveAlias: {
      '@elah/core': pkgSrcRel('core'),
      '@elah/editor': pkgSrcRel('editor'),
      '@elah/timeline': pkgSrcRel('timeline'),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@elah/core$': pkgSrcAbs('core'),
      '@elah/editor$': pkgSrcAbs('editor'),
      '@elah/timeline$': pkgSrcAbs('timeline'),
    }
    return config
  },
}

export default nextConfig
