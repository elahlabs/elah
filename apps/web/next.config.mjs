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
}

export default nextConfig
