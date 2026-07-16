import { posts, getPost } from '../../posts'
import { postToMarkdown } from '../../serialize'

// Raw markdown of a post at /blog/[slug]/md — a machine-readable full-content
// endpoint for LLM agents and doc fetchers (advertised from /llms.txt). The
// HTML page at /blog/[slug] stays canonical; this mirrors its body as text.

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) {
    return new Response(`# Not found\n\nNo blog post with slug "${slug}".\n`, {
      status: 404,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
  }

  return new Response(postToMarkdown(post), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
