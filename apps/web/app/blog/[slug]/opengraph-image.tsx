import { ImageResponse } from 'next/og'
import { posts, getPost } from '../posts'

// Per-post file-based OG image: Next serves this at /blog/[slug]/opengraph-image
// and injects og:image + twitter:image for each article, so every post gets a
// distinct social card (title + category) instead of the shared site image.
export const alt = 'elah engineering blog'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }))
}

export default async function BlogOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPost(slug)
  const title = post?.title ?? 'elah blog'
  const category = post?.category ?? 'Engineering'
  const readingTime = post?.readingTime ?? ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#111010',
          padding: 72,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: '#fcf9f8' }} />
          <div style={{ fontSize: 26, color: '#9b9391', letterSpacing: 4 }}>
            {`${category.toUpperCase()} · ELAH BLOG`}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: title.length > 44 ? 64 : 80,
            fontWeight: 700,
            color: '#fcf9f8',
            letterSpacing: -2,
            lineHeight: 1.08,
            maxWidth: 1040,
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid #312d2d',
            paddingTop: 32,
          }}
        >
          <div style={{ fontSize: 28, color: '#9b9391' }}>elah.dev/blog</div>
          <div style={{ fontSize: 28, color: '#9b9391' }}>{readingTime}</div>
        </div>
      </div>
    ),
    size
  )
}
