import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { CodeBlock, InlineCode } from '@/components/docs/CodeBlock'
import { JsonLd } from '@/components/seo/JsonLd'
import { siteConfig } from '@/config/site'
import { posts, getPost, categoryColors, type Block } from '../posts'

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return { title: 'Not found' }
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      url: `/blog/${post.slug}`,
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
      modifiedTime: post.date,
      authors: [siteConfig.url],
      section: post.category,
      tags: [post.category],
    },
    twitter: { card: 'summary_large_image', title: post.title, description: post.excerpt },
  }
}

// Renders inline `code` spans inside a paragraph string by splitting on backticks.
function renderInline(text: string) {
  return text.split('`').map((segment, i) =>
    i % 2 === 1 ? <InlineCode key={i}>{segment}</InlineCode> : <span key={i}>{segment}</span>
  )
}

function renderBlock(block: Block, i: number) {
  switch (block.type) {
    case 'h2':
      return (
        <h2
          key={i}
          id={block.id}
          className="mb-4 mt-10 scroll-mt-24 text-xl font-semibold tracking-tight text-on-surface"
          style={{ fontFamily: 'var(--font-inter), sans-serif' }}
        >
          {block.text}
        </h2>
      )
    case 'p':
      return (
        <p key={i} className="mb-5 text-sm leading-relaxed text-on-surface-variant">
          {renderInline(block.text)}
        </p>
      )
    case 'code':
      return (
        <div key={i} className="mb-5">
          <CodeBlock language={block.language} filename={block.filename} code={block.code} />
        </div>
      )
    case 'note':
      return (
        <div key={i} className="mb-5 rounded-md border border-outline-variant bg-surface-low p-4">
          {block.title && (
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">
              {block.title}
            </div>
          )}
          <p className="text-xs leading-relaxed text-on-surface-variant">{renderInline(block.text)}</p>
        </div>
      )
    case 'quote':
      return (
        <blockquote
          key={i}
          className="mb-5 border-l-2 border-primary pl-4 text-sm italic leading-relaxed text-on-surface"
        >
          {renderInline(block.text)}
        </blockquote>
      )
    case 'list':
      return (
        <ul key={i} className="mb-5 list-disc space-y-2 pl-5">
          {block.items.map((item, j) => (
            <li key={j} className="text-sm leading-relaxed text-on-surface-variant">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      )
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) notFound()

  const toc = post.content.filter((b): b is Extract<Block, { type: 'h2' }> => b.type === 'h2')

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    image: `${siteConfig.url}/blog/${post.slug}/opengraph-image`,
    datePublished: post.date,
    dateModified: post.date,
    articleSection: post.category,
    author: { '@type': 'Organization', name: 'elah', url: siteConfig.url },
    publisher: { '@type': 'Organization', name: 'elah', url: siteConfig.url },
    mainEntityOfPage: `${siteConfig.url}/blog/${post.slug}`,
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <JsonLd data={articleJsonLd} />
      <Navbar />

      <main id="main" className="flex-1">
        {/* Header */}
        <div className="border-b border-outline-variant bg-surface py-14">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <Link
              href="/blog"
              className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:text-on-surface"
            >
              <ArrowLeft className="h-3 w-3" />
              All posts
            </Link>
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-2xs font-medium ${categoryColors[post.category] ?? 'text-on-surface-variant bg-surface-high'}`}
              >
                {post.category}
              </span>
              <span className="text-2xs text-on-surface-variant">{post.readingTime}</span>
            </div>
            <h1
              className="text-3xl font-semibold tracking-tight text-on-surface md:text-4xl"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              {post.title}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">{post.excerpt}</p>
            <time dateTime={post.date} className="mt-4 block text-xs text-on-surface-variant">
              {post.date}
            </time>
          </div>
        </div>

        {/* Body + TOC */}
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="flex gap-12">
            <article className="min-w-0 flex-1">
              {post.content.map(renderBlock)}

              {/* Footer CTA */}
              <div className="mt-12 rounded-md border border-outline-variant bg-surface-low p-5">
                <p className="text-sm text-on-surface">
                  Building something with browser-native video?
                </p>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  Try the SDK, read the docs, or join the conversation.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href="/docs/getting-started"
                    className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
                  >
                    Get started
                  </Link>
                  <a
                    href="https://discord.gg/8CeZ2XbPy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-outline px-3 py-1.5 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container"
                  >
                    Join Discord
                  </a>
                </div>
              </div>
            </article>

            {/* TOC */}
            {toc.length > 0 && (
              <nav aria-label="Table of contents" className="hidden w-48 shrink-0 lg:block">
                <div className="sticky top-24">
                  <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-90">
                    On this page
                  </div>
                  <ul className="space-y-2">
                    {toc.map((h) => (
                      <li key={h.id}>
                        <a
                          href={`#${h.id}`}
                          className="block text-xs leading-snug text-on-surface-variant transition-colors hover:text-on-surface"
                        >
                          {h.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </nav>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
