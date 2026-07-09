'use client'

import { useCallback, useMemo, useState } from 'react'
import { Wand2, Send, X, Check } from 'lucide-react'
import {
  useTimelineEngine,
  useSelectionStore,
  useMediaLibraryStore,
  interpretEditCommands,
  type EditCommand,
} from '@elah/editor'

/**
 * `/edit` command bar — the natural-language editing surface.
 *
 * Serializes the current timeline, sends it plus the user's instruction to
 * /api/ai/edit-agent, and previews the planned EditCommands. The user confirms
 * before anything mutates; execution runs through interpretEditCommands, so the
 * whole edit is one undo entry. Video understanding (capturing the source clip's
 * bytes for Gemini) is wired separately — this bar already works for
 * frame/clip-level instructions ("split the selected clip in half",
 * "trim the first clip to 2 seconds").
 */

const FPS = 30

/**
 * Hard ceiling on the source clip we'll ship for analysis. The server routes
 * clips ≤15MB inline and larger ones through the Gemini Files API (cached), which
 * accepts up to 2GB — but sending 100MB+ through our own route is wasteful, so we
 * cap here. Over the cap → clear error instead of a silent giant upload.
 */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

/** Words that signal the request is about video CONTENT, not just frames. Only
 *  then do we spend a Gemini call + upload the clip. */
const CONTENT_CUES = /\b(where|when|says?|saying|said|jump|scene|moment|shows?|appears?|talk|speak|face|person|during|part)\b/i

interface PlannerClip {
  clipId: string
  trackId: string
  type: string
  startFrame: number
  durationFrames: number
  sourceStartFrame: number
}

interface VideoPayload {
  dataBase64: string
  mimeType: string
  query: string
  clipId: string
  /** Stable source identity so the server can cache the Files-API upload. */
  cacheKey?: string
}

interface PlannerTrack {
  trackId: string
  kind: string
}

type BarState = 'idle' | 'planning' | 'reviewing'

export interface EditCommandBarProps {
  fps?: number
  className?: string
}

export function EditCommandBar({ fps = FPS, className }: EditCommandBarProps) {
  const engine = useTimelineEngine()
  const [state, setState] = useState<BarState>('idle')
  const [input, setInput] = useState('')
  const [commands, setCommands] = useState<EditCommand[]>([])
  const [explanation, setExplanation] = useState('')
  const [error, setError] = useState('')

  const disabled = state === 'planning'

  /** Flatten the engine project into the compact shape the planner expects. */
  const readTimeline = useCallback((): {
    fps: number
    clips: PlannerClip[]
    tracks: PlannerTrack[]
  } => {
    const project = engine.getProject()
    const clips: PlannerClip[] = []
    for (const [trackId, trackClips] of Object.entries(project.clips)) {
      for (const clip of trackClips) {
        clips.push({
          clipId: clip.id,
          trackId,
          type: clip.type,
          startFrame: clip.startFrame,
          durationFrames: clip.durationFrames,
          sourceStartFrame: clip.sourceStartFrame,
        })
      }
    }
    // Include every track (even empty lanes) so `move` can target them.
    const tracks: PlannerTrack[] = project.tracks.map((t) => ({ trackId: t.id, kind: t.kind }))
    return { fps, clips, tracks }
  }, [engine, fps])

  /**
   * Resolve the video clip to analyze: the selected clip if it's a video,
   * otherwise the first video clip on the timeline. Returns null when there is
   * no video to look at.
   */
  const resolveVideoClip = useCallback(() => {
    const project = engine.getProject()
    const selected = useSelectionStore.getState().selectedClipIds
    for (const [, trackClips] of Object.entries(project.clips)) {
      for (const clip of trackClips) {
        if (clip.type === 'video' && selected.has(clip.id)) return clip
      }
    }
    for (const [, trackClips] of Object.entries(project.clips)) {
      for (const clip of trackClips) {
        if (clip.type === 'video') return clip
      }
    }
    return null
  }, [engine])

  /** Fetch the clip's source bytes and base64-encode them, size-guarded. */
  const captureVideo = useCallback(
    async (query: string): Promise<VideoPayload | null> => {
      const clip = resolveVideoClip()
      if (!clip) return null

      const asset = clip.assetId
        ? useMediaLibraryStore.getState().assets[clip.assetId]
        : undefined
      const srcUrl = asset?.src ?? clip.src
      if (!srcUrl) return null
      if (asset && asset.byteSize > MAX_VIDEO_BYTES) {
        throw new Error(
          `Video is too large for inline analysis (${(asset.byteSize / 1024 / 1024).toFixed(1)}MB > 12MB).`,
        )
      }

      const blob = await fetch(srcUrl).then((r) => r.blob())
      if (blob.size > MAX_VIDEO_BYTES) {
        throw new Error(
          `Video is too large for inline analysis (${(blob.size / 1024 / 1024).toFixed(1)}MB > 12MB).`,
        )
      }
      const dataBase64 = await blobToBase64(blob)
      const cacheKey = asset ? `${asset.id}:${asset.lastModified}` : undefined
      return { dataBase64, mimeType: blob.type || 'video/mp4', query, clipId: clip.id, cacheKey }
    },
    [resolveVideoClip],
  )

  const submit = useCallback(async () => {
    // Strip a leading "/edit" (or "/trim", "/split", "/cut") so the user can type
    // it as a slash command; the planner reads plain intent.
    const request = input.replace(/^\/\w+\s*/, '').trim()
    if (!request || disabled) return

    setError('')
    setCommands([])
    setExplanation('')
    setState('planning')

    try {
      // Only spend a Gemini call + upload when the request is about video content.
      let video: VideoPayload | null = null
      if (CONTENT_CUES.test(request)) {
        video = await captureVideo(request)
      }

      const res = await fetch('/api/ai/edit-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request, timeline: readTimeline(), video: video ?? undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`)
        setState('idle')
        return
      }
      if (!Array.isArray(data.commands) || data.commands.length === 0) {
        setError(data.explanation || 'No edits were planned for that request.')
        setState('idle')
        return
      }
      setCommands(data.commands)
      setExplanation(typeof data.explanation === 'string' ? data.explanation : '')
      setState('reviewing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.')
      setState('idle')
    }
  }, [input, disabled, readTimeline, captureVideo])

  const apply = useCallback(() => {
    // interpretEditCommands runs inside engine.batch(), which rethrows if a
    // recipe step throws — guard so an unexpected engine error surfaces as a
    // message instead of an unhandled render crash.
    try {
      const results = interpretEditCommands(engine, commands, 'AI edit')
      const failed = results.filter((r) => !r.ok)
      if (failed.length === results.length) {
        setError('None of the planned edits could be applied to the current timeline.')
      } else {
        setInput('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Applying the edit failed.')
    } finally {
      setCommands([])
      setExplanation('')
      setState('idle')
    }
  }, [engine, commands])

  const cancel = useCallback(() => {
    setCommands([])
    setExplanation('')
    setState('idle')
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  const summary = useMemo(() => commands.map(describeCommand), [commands])

  return (
    <div
      className={`flex flex-col gap-2 border-t border-ed-border bg-ed-bg-2 px-3 py-2 ${className ?? ''}`}
    >
      {state === 'reviewing' && (
        <div className="rounded-lg border border-ed-border bg-ed-bg p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-semibold tracking-wide text-ed-text-muted">
              PLANNED EDITS
            </span>
            <button
              type="button"
              onClick={cancel}
              aria-label="Discard planned edits"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-ed-text-muted hover:text-ed-text"
            >
              <X size={13} />
            </button>
          </div>
          {explanation && (
            <p className="pb-1.5 text-[11px] text-ed-text-muted">{explanation}</p>
          )}
          <ul className="flex flex-col gap-1">
            {summary.map((line, i) => (
              <li key={i} className="font-mono text-[11px] text-ed-text">
                {line}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-ed-border px-2.5 py-1 text-[11px] text-ed-text-muted hover:text-ed-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="inline-flex items-center gap-1 rounded-md bg-ed-accent px-2.5 py-1 text-[11px] font-semibold text-black"
            >
              <Check size={12} /> Apply
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-ed-error">{error}</p>}

      <div className="flex items-center gap-2">
        <Wand2 size={14} className="shrink-0 text-ed-accent" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="/edit — describe an edit, e.g. cut where the person says Hi"
          className="min-w-0 flex-1 rounded-md border border-ed-border bg-ed-bg px-2.5 py-1.5 text-[12px] placeholder:text-ed-text-muted focus:border-ed-accent focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || !input.trim()}
          aria-label="Plan edit"
          className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-ed-accent text-black disabled:opacity-40"
        >
          {state === 'planning' ? (
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30"
              style={{ borderTopColor: '#000' }}
            />
          ) : (
            <Send size={13} />
          )}
        </button>
      </div>
    </div>
  )
}

/** Human-readable one-liner for a planned command, shown in the review list. */
function describeCommand(c: EditCommand): string {
  switch (c.kind) {
    case 'trim':
      return `trim ${short(c.clipId)} → start ${c.startFrame}, ${c.durationFrames}f`
    case 'split':
      return `split ${short(c.clipId)} @ frame ${c.atFrame}`
    case 'delete':
      return `delete ${short(c.clipId)}`
    case 'move':
      return `move ${short(c.clipId)} → frame ${c.startFrame}`
    case 'cutRange':
      return `cut ${short(c.clipId)} [${c.fromFrame}–${c.toFrame})`
    default:
      return 'unknown command'
  }
}

function short(id: string): string {
  return id.length > 8 ? `${id.slice(0, 6)}…` : id
}

/** Blob → bare base64 (no data: prefix). FileReader handles large blobs. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read video.'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}
