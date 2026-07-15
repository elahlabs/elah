import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { posts, categoryColors } from './posts'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Engineering deep-dives, architecture decisions, and release notes from elah.',
  alternates: { canonical: '/blog' },
}

export default function BlogPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <div className="border-b border-outline-variant bg-surface py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-90">Engineering</div>
            <h1
              className="text-3xl font-semibold tracking-tight text-on-surface md:text-4xl"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              Blog
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-on-surface-variant">
              Architecture decisions, implementation deep-dives, and lessons from building browser-native video infrastructure.
            </p>
          </div>
        </div>

        {/* Posts */}
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <article
                key={post.slug}
                className="group flex flex-col overflow-hidden rounded-md border border-outline-variant bg-surface-container p-5 transition-colors hover:border-outline"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-2xs font-medium ${categoryColors[post.category] ?? 'text-on-surface-variant bg-surface-high'}`}>
                    {post.category}
                  </span>
                  <span className="text-2xs text-on-surface-variant">{post.readingTime}</span>
                </div>

                <h2
                  className="mb-2 text-sm font-semibold leading-snug text-on-surface"
                  style={{ fontFamily: 'var(--font-inter), sans-serif' }}
                >
                  {post.title}
                </h2>

                <p className="mb-4 flex-1 text-xs leading-relaxed text-on-surface-variant">
                  {post.excerpt}
                </p>

                <div className="flex items-center justify-between">
                  <time dateTime={post.date} className="text-xs text-on-surface-variant">
                    {post.date}
                  </time>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
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
