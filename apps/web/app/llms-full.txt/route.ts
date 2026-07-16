import { siteConfig } from '@/config/site'
import { posts } from '../blog/posts'
import { postToMarkdown } from '../blog/serialize'

/**
 * Generates /llms-full.txt — the full-content companion to /llms.txt. Where
 * llms.txt is a curated link index, this concatenates every blog post's
 * complete markdown body so an agent can ingest the writing in a single fetch
 * without crawling each HTML page. Derived from the blog source of truth, so
 * new posts appear automatically.
 */
export function GET(): Response {
  const ordered = [...posts].sort((a, b) => b.date.localeCompare(a.date))

  const body = `# ${siteConfig.name} — full blog content

> ${siteConfig.description}

This file concatenates the full markdown of every post at ${siteConfig.url}/blog.
The curated link index lives at ${siteConfig.url}/llms.txt. Each post is also
available individually at ${siteConfig.url}/blog/<slug>/md.

${ordered.map((post) => postToMarkdown(post)).join('\n\n---\n\n')}
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
