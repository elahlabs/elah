import { NextResponse, type NextRequest } from 'next/server'
import { mapVideoEventsToTimeline, type TimelineEvent } from '@elah/core'
import { geminiVideoUnderstanding } from '@/lib/ai/videoUnderstanding'
import { groqEditPlanner, type PlannerTimelineState } from '@/lib/ai/editPlanner'

/**
 * POST /api/ai/edit-agent
 *
 * Orchestrates the two-stage AI edit agent:
 *   1. (optional) Gemini video understanding — locate the requested moments.
 *   2. Groq command planning — turn the request + events + timeline into
 *      validated EditCommands the client runs against the engine.
 *
 * Body:
 *   {
 *     request: string,                    // natural-language edit instruction
 *     timeline: PlannerTimelineState,     // { fps, clips: [...] }
 *     video?: { dataBase64, mimeType, query }   // include to run understanding
 *   }
 *
 * Response: { commands, events, explanation }
 * Errors follow the api/ai/topics contract: 400 bad input, 502 upstream failure.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const b = body as {
    request?: unknown
    timeline?: unknown
    video?: { dataBase64?: unknown; mimeType?: unknown; query?: unknown; clipId?: unknown; cacheKey?: unknown }
  }

  const request = typeof b?.request === 'string' ? b.request.trim() : ''
  if (!request) {
    return NextResponse.json({ error: 'Missing "request".' }, { status: 400 })
  }

  const timeline = b?.timeline as PlannerTimelineState | undefined
  if (!timeline || typeof timeline.fps !== 'number' || !Array.isArray(timeline.clips)) {
    return NextResponse.json({ error: 'Missing or invalid "timeline".' }, { status: 400 })
  }

  try {
    let events: TimelineEvent[] | undefined
    if (b.video && typeof b.video.dataBase64 === 'string' && typeof b.video.mimeType === 'string') {
      const query = typeof b.video.query === 'string' && b.video.query.trim() ? b.video.query.trim() : request

      // Stage 1: locate the moments in the source video (seconds).
      const cacheKey = typeof b.video.cacheKey === 'string' ? b.video.cacheKey : undefined
      const sourceEvents = await geminiVideoUnderstanding.analyzeVideo(
        { dataBase64: b.video.dataBase64, mimeType: b.video.mimeType, query, cacheKey },
        req.signal,
      )

      // Map source-seconds to timeline frames for the clip the video came from.
      // Without a clip we can't place the events, so the planner runs text-only.
      const clip = timeline.clips.find((c) => c.clipId === b.video?.clipId)
      if (clip) {
        events = mapVideoEventsToTimeline(
          {
            clipId: clip.clipId,
            trackId: clip.trackId,
            startFrame: clip.startFrame,
            durationFrames: clip.durationFrames,
            sourceStartFrame: clip.sourceStartFrame,
          },
          sourceEvents,
          timeline.fps,
        )
      }
    }

    const { commands, explanation } = await groqEditPlanner.planEdits(
      { request: request.slice(0, 500), timeline, events },
      req.signal,
    )

    return NextResponse.json({ commands, events: events ?? [], explanation })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Edit agent failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
