import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Engineering deep-dives, architecture decisions, and release notes from Precision Studio.',
}

const posts = [
  {
    slug: 'webcodecs-frame-pool-exhaustion',
    date: '2026-06-07',
    category: 'Architecture',
    title: 'Solving WebCodecs Frame Pool Exhaustion',
    excerpt:
      'When the hardware output pool fills up, WebCodecs VideoDecoder stalls silently. Here\'s how we found it, why the copy-and-close pattern fixes it, and what to watch for in your own decode pipeline.',
    readingTime: '8 min read',
  },
  {
    slug: 'renderer-agnostic-core',
    date: '2026-06-04',
    category: 'Architecture',
    title: 'Why the Core Has No Renderer Imports',
    excerpt:
      'A renderer-agnostic core means resolveTimeline() runs identically in the browser, in a worker, and in tests. Here\'s the interface boundary we drew and how it keeps preview and export in sync.',
    readingTime: '6 min read',
  },
  {
    slug: 'integer-frames',
    date: '2026-05-28',
    category: 'Design',
    title: 'Frames as the Primitive Unit of Time',
    excerpt:
      'Every NLE that uses floating-point seconds eventually ships a subtle drift bug. Using integer frames eliminates an entire class of problems at the cost of one invariant every developer needs to know.',
    readingTime: '5 min read',
  },
  {
    slug: 'transition-architecture',
    date: '2026-06-01',
    category: 'Implementation',
    title: 'Snapshot-Overlay Transitions: Preview and Export in Sync',
    excerpt:
      'GPU crossfade is the obvious approach. It is also the wrong one for a renderer-agnostic system. Here is the snapshot-overlay architecture that keeps CSS preview and OffscreenCanvas export using the same resolver output.',
    readingTime: '7 min read',
  },
  {
    slug: 'webgl2-gpu-renderer',
    date: '2026-05-20',
    category: 'Implementation',
    title: 'Building a WebGL2 Renderer for an NLE',
    excerpt:
      'Textured quads, zIndex sorting, context-loss recovery, and the 2D-canvas-to-texture pipeline for text. A walkthrough of the GpuRenderer architecture.',
    readingTime: '10 min read',
  },
  {
    slug: 'immer-timeline-engine',
    date: '2026-05-15',
    category: 'Architecture',
    title: 'One Mutation Funnel: TimelineEngine with Immer',
    excerpt:
      'All edits go through one commit path. Structural sharing, batching, typed events, and a redo stack that does not bloat memory — how the TimelineEngine is designed.',
    readingTime: '6 min read',
  },
]

const categoryColors: Record<string, string> = {
  Architecture: 'text-secondary bg-blue-50 border-blue-200',
  Design: 'text-tertiary bg-green-50 border-green-200',
  Implementation: 'text-on-surface-variant bg-surface-high border-outline-variant',
}

export default function BlogPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <main className="flex-1">
        {/* Header */}
        <div className="border-b border-outline-variant bg-surface py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">Engineering</div>
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
                className="group flex flex-col overflow-hidden rounded-md border border-outline-variant bg-white p-5 transition-colors hover:border-outline"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-2xs font-medium ${categoryColors[post.category] ?? 'text-on-surface-variant bg-surface-high border-outline-variant'}`}>
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
                  <time className="text-xs text-on-surface-variant">{post.date}</time>
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
