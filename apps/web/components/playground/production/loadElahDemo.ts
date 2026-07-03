/**
 * loadElahDemo — one-click cinematic demo project.
 *
 * Fetches the bundled `/assets/*` media, registers it in the media library, and
 * composes a ~25s portrait (9:16) launch-trailer timeline: five scene clips
 * closed by the logo, a single music bed, 400ms fade transitions between every
 * visual beat, and minimal premium text overlays that fade in and out (no
 * scaling, no motion).
 *
 * The whole composition is built inside one `engine.batch()` so it lands as a
 * single undo entry, and seeks/zooms to a clean starting state when done.
 */
import {
  type TimelineEngine,
  type TimelineRef,
  type Transform,
  type MediaAsset,
  type MediaKind,
  importFiles,
  useMediaLibraryStore,
  usePlaybackStore,
  secondsToFrames,
} from '@elah/editor'
import type { RefObject } from 'react'

/** Portrait 9:16 launch-trailer stage. */
const STAGE = { width: 1080, height: 1920 }

/** 400ms transition / fade at the project fps. */
const FADE_MS = 400

const ASSET_BASE = '/assets'

const LOGO = 'cinematic-logo.png'
const AUDIO = 'audio.mp3'
const SCENES = ['scene-1.mp4', 'scene-2.mp4', 'scene-3.mp4', 'scene-4.mp4', 'scene-5.mp4']
const ALL_FILES = [LOGO, AUDIO, ...SCENES]

/** Premium muted-white text; the fade animation modulates down from here. */
const TEXT_OPACITY = 0.88

type Place =
  | 'center'
  | 'top-center'
  | 'top-left'
  | 'top-right'
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'

const PLACEMENT: Record<Place, { x: number; y: number; align: 'left' | 'center' | 'right' }> = {
  center: { x: 0.5, y: 0.5, align: 'center' },
  // Top row — reserved for the extra text lanes so they never overlap the
  // primary lower-third / centered overlays below.
  'top-center': { x: 0.5, y: 0.16, align: 'center' },
  'top-left': { x: 0.24, y: 0.16, align: 'left' },
  'top-right': { x: 0.76, y: 0.16, align: 'right' },
  'bottom-center': { x: 0.5, y: 0.84, align: 'center' },
  'bottom-left': { x: 0.24, y: 0.82, align: 'left' },
  'bottom-right': { x: 0.76, y: 0.82, align: 'right' },
}

function guessMime(name: string): string {
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.mp3')) return 'audio/mpeg'
  if (name.endsWith('.mp4')) return 'video/mp4'
  return 'application/octet-stream'
}

async function fetchAsFile(name: string): Promise<File> {
  const res = await fetch(`${ASSET_BASE}/${name}`)
  if (!res.ok) throw new Error(`Failed to load /assets/${name} (${res.status})`)
  const blob = await res.blob()
  // Force a known MIME so importFiles can infer kind even if the dev server
  // serves a generic content-type.
  return new File([blob], name, { type: blob.type || guessMime(name) })
}

/** Centered transform helper. */
function makeTransform(x: number, y: number): Transform {
  return { x, y, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
}

/**
 * Load every demo asset into the media library, then return them keyed by file
 * name. Re-importing is safe: `importFiles` dedupes, so a second click reuses
 * the already-registered assets.
 */
async function ensureAssets(): Promise<Record<string, MediaAsset>> {
  const files = await Promise.all(ALL_FILES.map(fetchAsFile))
  await importFiles(files)

  const assets = useMediaLibraryStore.getState().assets
  const byName: Record<string, MediaAsset> = {}
  for (const asset of Object.values(assets)) {
    if (ALL_FILES.includes(asset.name)) byName[asset.name] = asset
  }

  for (const name of ALL_FILES) {
    if (!byName[name]) throw new Error(`Asset failed to register: ${name}`)
  }
  return byName
}

export interface LoadElahDemoDeps {
  engine: TimelineEngine
  timelineRef: RefObject<TimelineRef | null>
}

/**
 * Build the cinematic demo project. Imports assets, composes tracks/transitions/
 * text, then seeks to 0 and fits the timeline zoom.
 */
export async function loadElahDemo({ engine, timelineRef }: LoadElahDemoDeps): Promise<void> {
  const byName = await ensureAssets()

  const fps = engine.getProject().fps
  const fadeFrames = Math.max(2, secondsToFrames(FADE_MS / 1000, fps))

  // Desired on-timeline lengths (frames). Scene clips trim to their source if
  // it is shorter; the closing logo is an image and can be any length.
  const LOGO_OUTRO = Math.round(fps * 5)
  const SCENE_LEN = [fps * 4, fps * 4, fps * 4, fps * 4, fps * 5].map(Math.round)

  // Resolve track ids from the fixed video/audio/text lanes.
  const project = engine.getProject()
  const videoTrack = project.tracks.find((t) => t.kind === 'video')
  const audioTrack = project.tracks.find((t) => t.kind === 'audio')
  const elementsTracks = project.tracks.filter((t) => t.kind === 'elements')
  const textTrack = elementsTracks[0]
  // Extra text lanes (Elements 2/3/4) beyond the primary one, if present.
  const extraTextTracks = elementsTracks.slice(1)
  if (!videoTrack || !audioTrack || !textTrack) {
    throw new Error('Expected video, audio, and elements tracks on the project')
  }

  engine.batch(() => {
    // Fresh start: portrait 9:16 stage for the trailer look.
    engine.setStage(STAGE.width, STAGE.height)

    // --- VIDEO TRACK: scenes · closing logo ------------------------------
    let cursor = 0
    const videoClipIds: string[] = []
    /** Returns [startFrame, durationFrames] of the placed clip. */
    const placeVisual = (asset: MediaAsset, desired: number): [number, number] => {
      const sourceFrames =
        asset.durationSec > 0 ? Math.max(1, secondsToFrames(asset.durationSec, fps)) : desired
      const duration = Math.min(desired, sourceFrames)
      const clip = engine.addClip({
        trackId: videoTrack.id,
        type: asset.kind === 'image' ? 'image' : 'video',
        name: asset.name,
        startFrame: cursor,
        durationFrames: duration,
        src: asset.src,
        assetId: asset.id,
      })
      videoClipIds.push(clip.id)
      const placed: [number, number] = [cursor, duration]
      cursor += duration
      return placed
    }

    const scenes = SCENES.map((name, i) => placeVisual(byName[name], SCENE_LEN[i]))
    const logoOutro = placeVisual(byName[LOGO], LOGO_OUTRO)

    const totalFrames = cursor

    // --- Fade transitions between every adjacent visual --------------------
    for (let i = 0; i < videoClipIds.length - 1; i++) {
      engine.addTransition({
        fromClipId: videoClipIds[i],
        toClipId: videoClipIds[i + 1],
        trackId: videoTrack.id,
        kind: 'fade',
        durationFrames: fadeFrames,
        easing: 'ease-out',
      })
    }

    // --- AUDIO TRACK: single music bed under the whole edit ----------------
    const audio = byName[AUDIO]
    const audioSource =
      audio.durationSec > 0 ? Math.max(1, secondsToFrames(audio.durationSec, fps)) : totalFrames
    engine.addClip({
      trackId: audioTrack.id,
      type: 'audio',
      name: audio.name,
      startFrame: 0,
      durationFrames: Math.min(totalFrames, audioSource),
      src: audio.src,
      assetId: audio.id,
    })

    // --- TEXT TRACK: minimal premium overlays, fade in + out ---------------
    const addText = (
      content: string,
      clip: [number, number],
      place: Place,
      opts: {
        fontSize: number
        fade?: number
        pad?: number
        yOffset?: number
        trackId?: string
      } = { fontSize: 84 },
    ) => {
      const [clipStart, clipDuration] = clip
      const trackId = opts.trackId ?? textTrack.id
      const pad = opts.pad ?? Math.round(fps * 0.3)
      const fade = opts.fade ?? fadeFrames
      const start = clipStart + pad
      const duration = Math.max(fade * 2 + 1, clipDuration - pad * 2)
      const { x, y, align } = PLACEMENT[place]
      const created = engine.addClip({
        trackId,
        type: 'text',
        name: content,
        startFrame: start,
        durationFrames: duration,
        opacity: TEXT_OPACITY,
        transform: makeTransform(x, y + (opts.yOffset ?? 0)),
        text: {
          content,
          fontSize: opts.fontSize,
          color: '#ffffff',
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          textAlign: align,
        },
      })
      // Entry/exit fade — resolved into opacity by the timeline resolver.
      engine.updateClip(created.id, trackId, {
        textAnimation: { in: 'fade', out: 'fade', durationFrames: fade },
      })
    }

    addText('Motion, engineered.', scenes[0], 'bottom-center', { fontSize: 76 })
    addText('Browser-native.', scenes[1], 'bottom-left', { fontSize: 64 })
    addText('Built for creator platforms.', scenes[2], 'center', { fontSize: 72 })
    addText('Precision timelines.', scenes[3], 'bottom-center', { fontSize: 64 })
    addText('Composable. Performant. Extendable.', scenes[4], 'center', { fontSize: 60 })

    // Final logo: a single centered tagline, slower fade for a premium close.
    const slowFade = Math.round(fps * 0.8)
    const finalPad = Math.round(fps * 0.5)
    addText('Browser-native video editing engine', logoOutro, 'center', {
      fontSize: 44,
      fade: slowFade,
      pad: finalPad,
      // Sit just below the centered logo rather than over it.
      yOffset: 0.10,
    })

    // --- EXTRA TEXT LANES: top-region captions -----------------------------
    // Each additional elements lane carries a themed set of small captions
    // pinned to the top row, so they read as kickers/tags above the primary
    // overlays and never collide with them (which all sit center/lower-third).
    const [laneKicker, laneTags, laneSpecs] = extraTextTracks
    if (laneKicker) {
      addText('ELAH', scenes[0], 'top-center', { fontSize: 40, trackId: laneKicker.id })
      addText('THE EDITOR', scenes[2], 'top-center', { fontSize: 40, trackId: laneKicker.id })
      addText('— 2026 —', scenes[4], 'top-center', { fontSize: 36, trackId: laneKicker.id })
    }
    if (laneTags) {
      addText('OPEN SOURCE', scenes[1], 'top-left', { fontSize: 34, trackId: laneTags.id })
      addText('ELAH LICENSED', scenes[3], 'top-left', { fontSize: 34, trackId: laneTags.id })
    }
    if (laneSpecs) {
      addText('9:16 · 30 FPS', scenes[0], 'top-right', { fontSize: 32, trackId: laneSpecs.id })
      addText('WEBCODECS', scenes[2], 'top-right', { fontSize: 32, trackId: laneSpecs.id })
      addText('GPU ACCELERATED', scenes[4], 'top-right', { fontSize: 30, trackId: laneSpecs.id })
    }
  }, 'Load Elah demo project')

  // --- Post-load: clean playback state ------------------------------------
  const playback = usePlaybackStore.getState()
  playback.pause()
  playback.setCurrentFrame(0)
  // Defer the fit until after the store sync has flushed and the timeline has
  // laid out, so it measures against the real total frame count.
  requestAnimationFrame(() => timelineRef.current?.fitToWindow())
}

// Re-exported for callers that want to surface the asset list (e.g. tooltips).
export const DEMO_ASSET_FILES = ALL_FILES
export type { MediaKind }
