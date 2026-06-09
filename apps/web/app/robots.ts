import { type MetadataRoute } from 'next'
import { siteConfig } from '@/config/site'

/**
 * Generates /robots.txt. Allows all well-behaved crawlers, blocks Next.js
 * internals, and points to the sitemap so Google can discover every page.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteConfig.url

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/_next/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
