/**
 * Edit planner — turns a natural-language request (+ optional video events +
 * current timeline state) into a validated array of EditCommands.
 *
 * Stage 2 of the AI edit agent. Provider-agnostic; default is Groq
 * (OpenAI-compatible chat completions, JSON mode). Because Groq's strict
 * json_schema constrained decoding is currently limited to the gpt-oss models,
 * we use JSON-object mode and validate the result ourselves — mirroring the
 * sanitizeOptions pattern in lib/ai/client.ts.
 */

import type { EditCommand, EditCommandKind, TimelineEvent } from '@elah/editor'
import { fetchWithRetry } from './retry'

/** Compact view of a clip the planner is allowed to edit. */
export interface PlannerClip {
  clipId: string
  trackId: string
  type: string
  startFrame: number
  durationFrames: number
  /** Trim in-point into the source — needed to map video events to timeline frames. */
  sourceStartFrame: number
}

/** A track the planner may target (including empty ones). */
export interface PlannerTrack {
  trackId: string
  kind: string
}

/** Everything the planner needs to know about the project. */
export interface PlannerTimelineState {
  fps: number
  clips: PlannerClip[]
  /** All tracks, so `move` can target an empty lane clips alone wouldn't reveal. */
  tracks?: PlannerTrack[]
}

export interface PlanEditsInput {
  request: string
  timeline: PlannerTimelineState
  /** Video-understanding hits already mapped to TIMELINE frames (see mapVideoEventsToTimeline). */
  events?: TimelineEvent[]
}

export interface EditPlanner {
  planEdits(input: PlanEditsInput, signal?: AbortSignal): Promise<{
    commands: EditCommand[]
    explanation: string
  }>
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

const VALID_KINDS: EditCommandKind[] = ['trim', 'split', 'delete', 'move', 'cutRange']

const SYSTEM_PROMPT = `You are the command planner for a browser video editor.
You translate a user's editing request into a JSON list of edit commands that run
against the timeline. TIME IS INTEGER FRAMES. Convert any seconds you are given to
frames using the provided fps (frame = round(seconds * fps)).

You may ONLY use these commands, and only reference clipId/trackId values that
appear in the provided timeline state:

- trim:     { "kind":"trim", "clipId","trackId", "startFrame","durationFrames" }
- split:    { "kind":"split", "clipId","trackId", "atFrame" }   // atFrame strictly inside the clip
- delete:   { "kind":"delete", "clipId","trackId" }
- move:     { "kind":"move", "clipId","fromTrackId","toTrackId","startFrame" }
- cutRange: { "kind":"cutRange", "clipId","trackId", "fromFrame","toFrame" }  // removes [fromFrame,toFrame)

Prefer cutRange to remove a segment the user wants gone. Keep the command list
minimal. If the request cannot be satisfied, return an empty commands array and
explain why.

If "events" are provided, they are moments already located in the video and
already converted to TIMELINE frames: each has { label, clipId, trackId,
startFrame, endFrame }. Use these frames directly — do NOT re-derive them. For a
"cut/remove where X" request, emit a cutRange on the event's clip using its
startFrame/endFrame.

Return ONLY JSON of the form:
{ "commands": [ ... ], "explanation": "one short sentence" }`

function getApiKey(): string {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not configured on the server.')
  return key
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Validate one raw object into an EditCommand, or null if malformed. Every clip
 * / track id is checked against the known sets so the model cannot invent
 * targets that would fail (or worse, alias) at execution time.
 */
function validateCommand(
  raw: unknown,
  clipIds: Set<string>,
  trackIds: Set<string>,
): EditCommand | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = o.kind as EditCommandKind
  if (!VALID_KINDS.includes(kind)) return null

  const hasClip = typeof o.clipId === 'string' && clipIds.has(o.clipId)

  switch (kind) {
    case 'trim': {
      const startFrame = num(o.startFrame)
      const durationFrames = num(o.durationFrames)
      if (!hasClip || typeof o.trackId !== 'string' || !trackIds.has(o.trackId)) return null
      if (startFrame === null || durationFrames === null || durationFrames < 1) return null
      return { kind, clipId: o.clipId as string, trackId: o.trackId, startFrame: Math.round(startFrame), durationFrames: Math.round(durationFrames) }
    }
    case 'split': {
      const atFrame = num(o.atFrame)
      if (!hasClip || typeof o.trackId !== 'string' || !trackIds.has(o.trackId) || atFrame === null) return null
      return { kind, clipId: o.clipId as string, trackId: o.trackId, atFrame: Math.round(atFrame) }
    }
    case 'delete': {
      if (!hasClip || typeof o.trackId !== 'string' || !trackIds.has(o.trackId)) return null
      return { kind, clipId: o.clipId as string, trackId: o.trackId }
    }
    case 'move': {
      const startFrame = num(o.startFrame)
      if (!hasClip || typeof o.fromTrackId !== 'string' || !trackIds.has(o.fromTrackId)) return null
      if (typeof o.toTrackId !== 'string' || !trackIds.has(o.toTrackId) || startFrame === null) return null
      return { kind, clipId: o.clipId as string, fromTrackId: o.fromTrackId, toTrackId: o.toTrackId, startFrame: Math.round(startFrame) }
    }
    case 'cutRange': {
      const fromFrame = num(o.fromFrame)
      const toFrame = num(o.toFrame)
      if (!hasClip || typeof o.trackId !== 'string' || !trackIds.has(o.trackId)) return null
      if (fromFrame === null || toFrame === null || toFrame <= fromFrame) return null
      return { kind, clipId: o.clipId as string, trackId: o.trackId, fromFrame: Math.round(fromFrame), toFrame: Math.round(toFrame) }
    }
    default:
      return null
  }
}

export const groqEditPlanner: EditPlanner = {
  async planEdits({ request, timeline, events }, signal) {
    const clipIds = new Set(timeline.clips.map((c) => c.clipId))
    // Prefer the explicit track list (includes empty lanes); fall back to the
    // tracks that clips sit on when it isn't provided.
    const trackIds = new Set(
      timeline.tracks?.length
        ? timeline.tracks.map((t) => t.trackId)
        : timeline.clips.map((c) => c.trackId),
    )

    const userContent = JSON.stringify({
      request,
      fps: timeline.fps,
      tracks: timeline.tracks ?? [],
      clips: timeline.clips,
      events: events ?? [],
    })

    const res = await fetchWithRetry(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    })

    if (!res.ok) throw new Error(`Groq request failed with status ${res.status}`)

    const data = await res.json()
    const content: unknown = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('Groq returned no content.')

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('Groq returned invalid JSON.')
    }

    const rawCommands = (parsed as { commands?: unknown })?.commands
    const explanation =
      typeof (parsed as { explanation?: unknown })?.explanation === 'string'
        ? ((parsed as { explanation: string }).explanation).trim().slice(0, 200)
        : ''

    const commands: EditCommand[] = []
    if (Array.isArray(rawCommands)) {
      for (const raw of rawCommands) {
        const cmd = validateCommand(raw, clipIds, trackIds)
        if (cmd) commands.push(cmd)
      }
    }

    return { commands, explanation }
  },
}
