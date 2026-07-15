// Serializers that turn a post's structured `Block[]` body into plain markdown
// (for agents via /blog/[slug]/md and /llms-full.txt) and into HTML (for the
// RSS `content:encoded` full body). `posts.ts` stays pure data; rendering to
// non-React targets lives here so all three consumers share one source of truth.

import { siteConfig } from '@/config/site'
import type { Block, Post } from './posts'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Inline `code` spans use backticks in the source text. Markdown passes them
// through as-is; for HTML we convert paired backticks to <code> elements.
function inlineToHtml(text: string): string {
  return text
    .split('`')
    .map((segment, i) => (i % 2 === 1 ? `<code>${escapeHtml(segment)}</code>` : escapeHtml(segment)))
    .join('')
}

function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case 'h2':
      return `## ${block.text}`
    case 'p':
      return block.text
    case 'code':
      return `\`\`\`${block.language ?? ''}\n${block.code}\n\`\`\``
    case 'note':
      return [block.title ? `> **${block.title}**` : null, `> ${block.text.replace(/\n/g, '\n> ')}`]
        .filter(Boolean)
        .join('\n>\n')
    case 'quote':
      return `> ${block.text}`
    case 'list':
      return block.items.map((item) => `- ${item}`).join('\n')
  }
}

function blockToHtml(block: Block): string {
  switch (block.type) {
    case 'h2':
      return `<h2 id="${block.id}">${escapeHtml(block.text)}</h2>`
    case 'p':
      return `<p>${inlineToHtml(block.text)}</p>`
    case 'code':
      return `<pre><code>${escapeHtml(block.code)}</code></pre>`
    case 'note':
      return `<blockquote>${block.title ? `<strong>${escapeHtml(block.title)}</strong> ` : ''}${inlineToHtml(block.text)}</blockquote>`
    case 'quote':
      return `<blockquote>${inlineToHtml(block.text)}</blockquote>`
    case 'list':
      return `<ul>${block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</ul>`
  }
}

/** Full post as clean markdown, with a canonical-link header block for agents. */
export function postToMarkdown(post: Post): string {
  const url = `${siteConfig.url}/blog/${post.slug}`
  const header = [
    `# ${post.title}`,
    '',
    `> ${post.excerpt}`,
    '',
    `**Published:** ${post.date} · **Category:** ${post.category} · **Reading time:** ${post.readingTime}`,
    `**Canonical:** ${url}`,
    '',
    '---',
    '',
  ].join('\n')
  const body = post.content.map(blockToMarkdown).join('\n\n')
  return `${header}${body}\n`
}

/** Full post body as HTML — used for RSS `content:encoded`. */
export function postToHtml(post: Post): string {
  return post.content.map(blockToHtml).join('\n')
}
