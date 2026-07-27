import { NextResponse, type NextRequest } from 'next/server'
import { generateTopicOptions } from '@/lib/ai/client'
import { getPostHogClient } from '@/lib/posthog-server'

/**
 * posthog-js mirrors its distinct_id into `ph_<token>_posthog` under the default
 * `localStorage+cookie` persistence. Reading it here keeps server-side events on the
 * same person as the browser's, instead of stranding them on a synthetic id.
 */
function distinctIdFromRequest(req: NextRequest): string | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  if (!token) return null
  const raw = req.cookies.get(`ph_${token}_posthog`)?.value
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const id = (parsed as { distinct_id?: unknown })?.distinct_id
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

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

  let options: Awaited<ReturnType<typeof generateTopicOptions>>
  try {
    options = await generateTopicOptions(prompt.slice(0, 500), req.signal)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Topic generation failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Analytics is best-effort: a missing token or a slow flush must never turn a
  // successful generation into a 502.
  try {
    const distinctId = distinctIdFromRequest(req)
    const posthog = getPostHogClient()
    posthog.capture({
      distinctId: distinctId ?? 'server',
      event: 'ai_topics_generated',
      properties: {
        options_count: options.length,
        // Without a browser id there is no real person to attach to; skip the
        // profile rather than minting a throwaway one per request.
        ...(distinctId ? {} : { $process_person_profile: false }),
      },
    })
    await posthog.flush()
  } catch {
    // swallowed by design
  }

  return NextResponse.json({ options })
}
