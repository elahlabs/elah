import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { CodeBlock, InlineCode } from '@/components/docs/CodeBlock'
import { JsonLd } from '@/components/seo/JsonLd'
import { siteConfig } from '@/config/site'
import { posts, getPost, type Block } from '../posts'
import { btnPrimary, btnSecondary, btnSmall, container, display, label, outline, sectionY } from '@/components/eb'

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
          className={`mb-4 mt-12 scroll-mt-24 text-[32px] leading-[1] font-extrabold text-on-surface ${display}`}
        >
          {block.text}
        </h2>
      )
    case 'p':
      return (
        <p key={i} className="mb-5 text-[16px] leading-[26px] text-on-surface-variant">
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
        <div key={i} className={`mb-5 bg-surface-low p-4 ${outline}`}>
          {block.title && (
            <div className={`mb-1 text-on-surface ${label}`}>
              {block.title}
            </div>
          )}
          <p className="text-[14px] leading-[22px] text-on-surface-variant">{renderInline(block.text)}</p>
        </div>
      )
    case 'quote':
      return (
        <blockquote
          key={i}
          className="mb-5 border-l-2 border-on-surface pl-4 text-[16px] italic leading-[26px] text-on-surface"
        >
          {renderInline(block.text)}
        </blockquote>
      )
    case 'list':
      return (
        <ul key={i} className="mb-5 list-disc space-y-2 pl-5">
          {block.items.map((item, j) => (
            <li key={j} className="text-[16px] leading-[26px] text-on-surface-variant">
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
          <div className={container}>
            <div className="max-w-3xl">
            <Link
              href="/blog"
              className={`mb-6 inline-flex items-center gap-1.5 text-on-surface underline decoration-primary underline-offset-4 ${label}`}
            >
              <ArrowLeft className="h-3 w-3" />
              All posts
            </Link>
            <div className="mb-3 flex items-center gap-2">
              <span className={`bg-surface-low px-2 py-[3px] text-on-surface ${label} ${outline}`}>
                {post.category}
              </span>
              <span className={`text-on-surface-variant ${label}`}>{post.readingTime}</span>
            </div>
            <h1 className={`m-0 text-[44px] leading-[0.95] font-extrabold tracking-[-0.3px] text-on-surface text-balance sm:text-[64px] ${display}`}>
              {post.title}
            </h1>
            <p className="mt-4 text-[17px] leading-[27px] text-on-surface-variant">{post.excerpt}</p>
            <time dateTime={post.date} className={`mt-4 block text-on-surface-variant ${label}`}>
              {post.date}
            </time>
            </div>
          </div>
        </div>

        {/* Body + TOC */}
        <div className={`${container} pt-12 ${sectionY}`}>
          <div className="flex max-w-[1000px] gap-12">
            <article className="min-w-0 max-w-3xl flex-1">
              {post.content.map(renderBlock)}

              {/* Footer CTA */}
              <div className={`mt-12 bg-surface-low p-5 ${outline}`}>
                <p className="text-[16px] text-on-surface">
                  Building something with browser-native video?
                </p>
                <p className="mt-1 text-[14px] leading-[22px] text-on-surface-variant">
                  Try the SDK, read the docs, or join the conversation.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/docs/getting-started" className={`${btnPrimary} ${btnSmall}`}>
                    Get started
                  </Link>
                  <a
                    href={siteConfig.links.discord}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${btnSecondary} ${btnSmall}`}
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
                  <div className={`mb-3 text-on-surface-variant ${label}`}>
                    On this page
                  </div>
                  <ul className="space-y-2">
                    {toc.map((h) => (
                      <li key={h.id}>
                        <a
                          href={`#${h.id}`}
                          className="block text-[13px] leading-snug text-on-surface-variant transition-colors hover:text-on-surface"
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
