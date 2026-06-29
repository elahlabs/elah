import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
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
