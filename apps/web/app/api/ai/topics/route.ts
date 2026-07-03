import { NextResponse, type NextRequest } from 'next/server'
import { generateTopicOptions } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const prompt =
    typeof (body as { prompt?: unknown })?.prompt === 'string'
      ? ((body as { prompt: string }).prompt).trim()
      : ''
  if (!prompt) {
    return NextResponse.json({ error: 'Missing "prompt".' }, { status: 400 })
  }

  try {
    const options = await generateTopicOptions(prompt.slice(0, 500), req.signal)
    return NextResponse.json({ options })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Topic generation failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
