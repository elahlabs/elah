import { NextResponse, type NextRequest } from 'next/server'
import { searchPhotos } from '@/lib/pexels/client'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query')?.trim()
  if (!query) {
    return NextResponse.json({ error: 'Missing "query" parameter.' }, { status: 400 })
  }
  const page = Number(searchParams.get('page') ?? '1') || 1
  const perPage = Number(searchParams.get('per_page') ?? '20') || 20

  try {
    const data = await searchPhotos({ query, page, perPage }, req.signal)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pexels photo search failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
