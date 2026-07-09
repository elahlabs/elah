import { type MetadataRoute } from 'next'
import { siteConfig } from '@/config/site'
import { posts } from './blog/posts'

// Keep in sync with the route tree and with app/llms.txt/route.ts.
const DOCS_PAGES = [
  'installation',
  'getting-started',
  'timeline',
  'editor',
  'export',
  'api',
  'architecture',
  'plugins',
]

const PLAYGROUND_PAGES = ['production', 'timeline', 'raw']

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url

  return [
    { url: base, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/docs`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    ...DOCS_PAGES.map((slug) => ({
      url: `${base}/docs/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    { url: `${base}/playgrounds`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/examples`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    ...PLAYGROUND_PAGES.map((slug) => ({
      url: `${base}/playground/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    { url: `${base}/showcase`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/blog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    ...posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: 'yearly' as const,
      priority: 0.6,
    })),
    { url: `${base}/changelog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/pricing`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
  ]
}
