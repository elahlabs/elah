import { NextResponse, type NextRequest } from 'next/server'
import { popularVideos, searchVideos } from '@/lib/pexels/client'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query')?.trim()
  const page = Number(searchParams.get('page') ?? '1') || 1
  const perPage = Number(searchParams.get('per_page') ?? '20') || 20

  try {
    const data = query
      ? await searchVideos({ query, page, perPage }, req.signal)
      : await popularVideos({ page, perPage }, req.signal)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pexels video search failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
