import { TimelineEngine, secondsToFrames, type Project } from '@elah/core'
import { CliError } from './errors'

/**
 * The AI-friendly build spec: times in seconds, assets by name, no engine
 * bookkeeping. `elah build` turns this into a full Project via TimelineEngine,
 * so every data-model invariant (overlap, source bounds, track caps) is
 * enforced by core, not re-implemented here.
 */
export interface BuildSpec {
  /** Frames per second — integer. Default 30. */
  fps?: number
  /** Output canvas in pixels. Default 1920x1080. */
  stage?: { width: number; height: number }
  /** Asset name → file path (relative to the spec file) or http(s) URL. */
  assets?: Record<string, string>
  clips: SpecClip[]
}

export interface SpecClipBase {
  track: 'video' | 'audio' | 'text' | 'image'
  /** Timeline position in seconds. */
  start: number
  /** Length in seconds. Optional for video/audio (defaults to the rest of the media). */
  duration?: number
  /** Normalized 0..1 position of the clip center on the stage. */
  x?: number
  y?: number
  scale?: number
  opacity?: number
}

export interface SpecMediaClip extends SpecClipBase {
  track: 'video' | 'audio' | 'image'
  /** Name from the spec's assets map. */
  asset: string
  /** Seconds into the source media to start from (video/audio). */
  sourceStart?: number
  volume?: number
}

export interface SpecTextClip extends SpecClipBase {
  track: 'text'
  text: string
  duration: number
  fontSize?: number
  color?: string
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  align?: 'left' | 'center' | 'right'
}

export type SpecClip = SpecMediaClip | SpecTextClip

export interface ProbedAsset {
  /** Resolved absolute path or URL, used as the clip src. */
  src: string
  /** Media duration in seconds (video/audio only; images pass undefined). */
  durationSec?: number
}

/**
 * Convert a validated spec into a Project through a real TimelineEngine.
 * `assets` maps asset names to their resolved+probed sources.
 */
export function specToProject(spec: BuildSpec, assets: Map<string, ProbedAsset>): Project {
  const fps = spec.fps ?? 30
  const stage = spec.stage ?? { width: 1920, height: 1080 }

  const engine = new TimelineEngine({
    fps,
    stage,
    initialTracks: [
      { kind: 'video', name: 'Video' },
      { kind: 'elements', name: 'Elements' },
      { kind: 'audio', name: 'Audio' },
    ],
  })

  const project = engine.getProject()
  const videoTrack = project.tracks.find((t) => t.kind === 'video')!.id
  // elements/audio tracks are allocated first-fit as overlaps demand
  const elementsTracks = [project.tracks.find((t) => t.kind === 'elements')!.id]
  const audioTracks = [project.tracks.find((t) => t.kind === 'audio')!.id]

  const occupied = new Map<string, Array<{ start: number; end: number }>>()

  const placeOnPool = (
    pool: string[],
    kind: 'elements' | 'audio',
    start: number,
    end: number
  ): string => {
    for (const trackId of pool) {
      const spans = occupied.get(trackId) ?? []
      if (spans.every((s) => end <= s.start || start >= s.end)) {
        occupied.set(trackId, [...spans, { start, end }])
        return trackId
      }
    }
    const track = engine.addTrack(kind, { name: `${kind === 'elements' ? 'Elements' : 'Audio'} ${pool.length + 1}` })
    pool.push(track.id)
    occupied.set(track.id, [{ start, end }])
    return track.id
  }

  spec.clips.forEach((clip, i) => {
    const where = `clips[${i}] (${clip.track}${'asset' in clip ? ` '${clip.asset}'` : ''})`
    const startFrame = secondsToFrames(clip.start, fps)

    try {
      if (clip.track === 'text') {
        const durationFrames = Math.max(1, secondsToFrames(clip.duration, fps))
        engine.addClip({
          type: 'text',
          trackId: placeOnPool(elementsTracks, 'elements', startFrame, startFrame + durationFrames),
          name: clip.text.slice(0, 24) || 'Text',
          startFrame,
          durationFrames,
          opacity: clip.opacity,
          transform: toTransform(clip),
          text: {
            content: clip.text,
            fontSize: clip.fontSize,
            color: clip.color,
            fontFamily: clip.fontFamily,
            fontWeight: clip.fontWeight,
            textAlign: clip.align,
          },
        })
        return
      }

      const asset = assets.get(clip.asset)
      if (!asset) throw new CliError(`${where}: unknown asset '${clip.asset}' — add it to the spec's assets map`)

      if (clip.track === 'image') {
        if (clip.duration === undefined) throw new CliError(`${where}: image clips need an explicit duration`)
        const durationFrames = Math.max(1, secondsToFrames(clip.duration, fps))
        engine.addClip({
          type: 'image',
          trackId: placeOnPool(elementsTracks, 'elements', startFrame, startFrame + durationFrames),
          name: clip.asset,
          startFrame,
          durationFrames,
          opacity: clip.opacity,
          transform: toTransform(clip),
          src: asset.src,
        })
        return
      }

      // video / audio — need source-length accounting
      if (asset.durationSec === undefined) {
        throw new CliError(`${where}: could not determine media duration — probe failed or asset is not audio/video`)
      }
      const sourceStartSec = clip.sourceStart ?? 0
      const available = asset.durationSec - sourceStartSec
      if (available <= 0) {
        throw new CliError(
          `${where}: sourceStart ${sourceStartSec}s is beyond the media length (${asset.durationSec.toFixed(2)}s)`
        )
      }
      const durationSec = clip.duration ?? available
      if (durationSec > available + 1 / fps) {
        throw new CliError(
          `${where}: duration ${durationSec}s exceeds the media's remaining ${available.toFixed(2)}s after sourceStart`
        )
      }
      const durationFrames = Math.max(1, Math.min(secondsToFrames(durationSec, fps), Math.floor(available * fps)))
      const sourceStartFrame = secondsToFrames(sourceStartSec, fps)

      const trackId =
        clip.track === 'video'
          ? videoTrack
          : placeOnPool(audioTracks, 'audio', startFrame, startFrame + durationFrames)

      const created = engine.addClip({
        type: clip.track,
        trackId,
        name: clip.asset,
        startFrame,
        durationFrames,
        volume: clip.volume,
        opacity: clip.opacity,
        transform: clip.track === 'video' ? toTransform(clip) : undefined,
        src: asset.src,
      })
      // addClip defaults sourceDurationFrames to durationFrames; widen to the
      // real media length so later trims/splits know the true source bounds
      engine.updateClip(created.id, trackId, {
        sourceStartFrame,
        sourceDurationFrames: Math.floor(asset.durationSec * fps),
      })
    } catch (err) {
      if (err instanceof CliError) throw err
      // engine addClip throws plain Errors on overlap / missing track
      throw new CliError(`${where}: ${(err as Error).message}`)
    }
  })

  return engine.getProject()
}

function toTransform(clip: SpecClipBase) {
  if (clip.x === undefined && clip.y === undefined && clip.scale === undefined) return undefined
  return {
    x: clip.x ?? 0.5,
    y: clip.y ?? 0.5,
    scale: clip.scale ?? 1,
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
  }
}

/** Structural validation with clear, path-addressed messages. */
export function validateSpec(value: unknown): BuildSpec {
  const fail = (detail: string): never => {
    throw new CliError(`Invalid spec: ${detail}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('expected a JSON object')
  const s = value as Record<string, unknown>

  if (s.fps !== undefined && (typeof s.fps !== 'number' || !Number.isInteger(s.fps) || s.fps <= 0)) {
    fail("'fps' must be a positive integer")
  }
  if (s.stage !== undefined) {
    const st = s.stage as Record<string, unknown>
    if (typeof st !== 'object' || st === null || typeof st.width !== 'number' || typeof st.height !== 'number') {
      fail("'stage' must be { width, height }")
    }
  }
  if (s.assets !== undefined) {
    if (typeof s.assets !== 'object' || s.assets === null || Array.isArray(s.assets)) {
      fail("'assets' must be an object mapping names to paths")
    }
    for (const [name, path] of Object.entries(s.assets as Record<string, unknown>)) {
      if (typeof path !== 'string' || path.length === 0) fail(`assets['${name}'] must be a non-empty string path`)
    }
  }
  if (!Array.isArray(s.clips) || s.clips.length === 0) fail("'clips' must be a non-empty array")

  const kinds = ['video', 'audio', 'text', 'image']
  ;(s.clips as Record<string, unknown>[]).forEach((c, i) => {
    const at = `clips[${i}]`
    if (typeof c !== 'object' || c === null) fail(`${at} must be an object`)
    if (!kinds.includes(c.track as string)) fail(`${at}.track must be one of: ${kinds.join(', ')}`)
    if (typeof c.start !== 'number' || c.start < 0) fail(`${at}.start must be a number >= 0 (seconds)`)
    if (c.duration !== undefined && (typeof c.duration !== 'number' || c.duration <= 0)) {
      fail(`${at}.duration must be a positive number of seconds`)
    }
    if (c.track === 'text') {
      if (typeof c.text !== 'string' || c.text.length === 0) fail(`${at}.text must be a non-empty string`)
      if (c.duration === undefined) fail(`${at}: text clips need an explicit duration`)
    } else if (typeof c.asset !== 'string' || (c.asset as string).length === 0) {
      fail(`${at}.asset must reference a name from the assets map`)
    }
    if (c.sourceStart !== undefined && (typeof c.sourceStart !== 'number' || (c.sourceStart as number) < 0)) {
      fail(`${at}.sourceStart must be a number >= 0 (seconds)`)
    }
  })

  return value as BuildSpec
}
