import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { posts } from './posts'
import { PageHeader } from '@/components/site/PageHeader'
import { cardLight, cardTitle, container, label, outline, sectionY } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Engineering deep-dives, architecture decisions, and release notes from elah.',
  alternates: { canonical: '/blog' },
}

export default function BlogPage() {
  // Newest first. Same expression as app/feed.xml/route.ts, so the listing and the feed cannot disagree.
  const sortedPosts = [...posts].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main id="main" className="flex-1">
        {/* Header */}
        <PageHeader
          eyebrow="Engineering"
          title="Blog"
          lede={
            <>
              Architecture decisions, implementation deep-dives, and lessons from building browser-native video infrastructure.
            </>
          }
        />

        {/* Posts */}
        <div className={`${container} pt-12 ${sectionY}`}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sortedPosts.map((post) => (
              <article
                key={post.slug}
                className={`group ${cardLight} min-w-0 gap-0 transition-colors hover:bg-surface-container`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className={`bg-surface px-2 py-[3px] text-on-surface ${label} ${outline}`}>
                    {post.category}
                  </span>
                  <span className={`text-on-surface-variant ${label}`}>{post.readingTime}</span>
                </div>

                <h2 className={`${cardTitle} mb-3`}>
                  {post.title}
                </h2>

                <p className="mb-5 flex-1 text-[15px] leading-[23px] text-on-surface-variant">
                  {post.excerpt}
                </p>

                <div className="flex items-center justify-between">
                  <time dateTime={post.date} className={`text-on-surface-variant ${label}`}>
                    {post.date}
                  </time>
                  <Link
                    href={`/blog/${post.slug}`}
                    className={`flex items-center gap-1 text-on-surface underline decoration-primary underline-offset-4 ${label}`}
                  >
                    Read
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
