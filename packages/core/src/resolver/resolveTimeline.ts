import type { Project, Clip, TransitionEasing } from '../types'
import type {
  Scene,
  ActiveVideoClip,
  ActiveAudioClip,
  ActiveTextClip,
  ActiveImageClip,
  ActiveShapeClip,
  ActiveFreehandClip,
} from './scene'

/** Elements tracks always render above every video/audio track. */
const ELEMENTS_ZINDEX_BASE = 1000000

function applyEasing(t: number, easing: TransitionEasing = 'linear'): number {
  const c = Math.max(0, Math.min(1, t))
  if (easing === 'ease-in') return c * c
  if (easing === 'ease-out') return c * (2 - c)
  return c
}

function findClipById(
  clips: Project['clips'],
  clipId: string,
): { clip: Clip; trackId: string } | null {
  for (const [trackId, trackClips] of Object.entries(clips)) {
    const clip = trackClips.find((c) => c.id === clipId)
    if (clip) return { clip, trackId }
  }
  return null
}

/**
 * resolveTimeline — pure, deterministic frame resolver.
 *
 * Given a frame number and the current project state, returns a Scene
 * describing exactly which clips are active and what their playback state is.
 *
 * Guarantees:
 *  - Deterministic: same (frame, project) always produces structurally equal output
 *  - No side-effects: safe in tests, Web Workers, WASM pipelines, export flows
 *  - No DOM, no React, no Zustand — plain data in, plain data out
 *
 * Exclusion rules:
 *  - Tracks with `disabled: true` are skipped entirely
 *  - Clips with `disabled: true` are skipped
 *  - Clips that do not overlap `frame` are skipped
 *  - Muted tracks produce audio/video clips with `volume: 0`
 *  - Tracks with solo enabled exclude all other tracks of the same kind from
 *    the scene. Image clips live on video tracks and follow video solo rules.
 *
 * zIndex semantics:
 *  Higher zIndex = closer to the viewer (front / on top), matching CSS/canvas
 *  conventions. Arrays are sorted ascending so renderers iterate forward and
 *  the last element (highest zIndex) renders on top.
 *  The `* 1000` multiplier reserves space for future sub-layer offsets
 *  (e.g. text overlays always +100 above their base video layer).
 *  Elements tracks (text/shape/freehand) are offset above every video/audio
 *  track by ELEMENTS_ZINDEX_BASE, but still ordered by track.order relative to
 *  each other — so when multiple elements tracks overlap in time, the one
 *  placed higher in the UI (lower order) still renders on top, matching the
 *  video-track convention instead of collapsing to one flat value.
 *
 * @example
 * ```ts
 * const scene = resolveTimeline(currentFrame, engine.getProject())
 * for (const v of scene.videos) {
 *   videoEl.src = v.src
 *   videoEl.currentTime = v.sourceFrame / project.fps
 * }
 * ```
 */
export function resolveTimeline(frame: number, project: Project): Scene {
  const scene: Scene = {
    frame,
    fps: project.fps,
    stage: project.stage,
    videos: [],
    audios: [],
    texts: [],
    images: [],
    shapes: [],
    freehand: [],
    transitions: [],
  }

  // --- Solo pre-pass ---------------------------------------------------------
  // If any track of a given kind is solo'd, only that track (or those tracks)
  // will contribute clips. Image clips live on video tracks and share solo rules.
  const hasSolo = { video: false, audio: false, elements: false }
  for (const t of project.tracks) {
    if (t.solo) {
      if (t.kind === 'video' || t.kind === 'audio' || t.kind === 'elements') {
        hasSolo[t.kind] = true
      }
    }
  }

  // --- zIndex pre-pass -------------------------------------------------------
  // Compute a base multiplier from the highest track.order so that zIndex
  // increases toward the viewer: track.order=0 (topmost in UI) gets the highest
  // zIndex value. Multiplied by 1000 to leave room for future sub-layer offsets.
  const maxOrder = project.tracks.reduce((m, t) => Math.max(m, t.order), 0)

  // --- Main loop -------------------------------------------------------------
  for (const track of project.tracks) {
    if (track.disabled) continue

    // Solo exclusion: skip this track if another track of the same kind is
    // solo'd and this one isn't.
    if (hasSolo[track.kind as 'video' | 'audio' | 'elements'] && !track.solo) continue

    const clips = project.clips[track.id]
    if (!clips || clips.length === 0) continue

    // Elements tracks sit above every video/audio track (ELEMENTS_ZINDEX_BASE),
    // but keep the same order-based ranking as everyone else so relative
    // stacking among multiple elements tracks follows the UI's track order
    // instead of colliding on one shared zIndex.
    const zIndex = track.kind === 'elements'
      ? ELEMENTS_ZINDEX_BASE + (maxOrder - track.order) * 1000
      : (maxOrder - track.order) * 1000

    for (const clip of clips) {
      if (clip.disabled) continue
      if (frame < clip.startFrame) continue
      if (frame >= clip.startFrame + clip.durationFrames) continue

      // How far into the source asset we are at this frame.
      const sourceFrame = frame - clip.startFrame + clip.sourceStartFrame
      const opacity = clip.opacity ?? 1
      const baseVolume = clip.volume ?? 1
      // Fold track gain into effective volume; mute zeroes both.
      const trackGain = track.muted ? 0 : (track.volume ?? 1)
      const volume = baseVolume * trackGain

      if (clip.type === 'video' && clip.src) {
        const active: ActiveVideoClip = {
          type: 'video',
          id: clip.id,
          trackId: clip.trackId,
          name: clip.name,
          src: clip.src,
          sourceFrame,
          opacity,
          volume,
          zIndex,
          ...(clip.transform ? { transform: clip.transform } : {}),
        }
        scene.videos.push(active)
      } else if (clip.type === 'audio' && clip.src) {
        const active: ActiveAudioClip = {
          type: 'audio',
          id: clip.id,
          trackId: clip.trackId,
          name: clip.name,
          src: clip.src,
          sourceFrame,
          opacity: 1,
          volume,
          zIndex,
          ...(clip.transform ? { transform: clip.transform } : {}),
        }
        scene.audios.push(active)
      } else if (clip.type === 'text') {
        // Resolve entry/exit animation into opacity so both renderers get the
        // animated value for free — neither renderer needs to know about animations.
        let resolvedOpacity = opacity
        const anim = clip.textAnimation
        if (anim) {
          const d = Math.max(1, anim.durationFrames)
          const localFrame = frame - clip.startFrame
          if (anim.in === 'fade') {
            resolvedOpacity = Math.min(resolvedOpacity, Math.min(1, localFrame / d))
          }
          if (anim.out === 'fade') {
            resolvedOpacity = Math.min(resolvedOpacity, Math.min(1, (clip.durationFrames - localFrame) / d))
          }
        }

        const active: ActiveTextClip = {
          type: 'text',
          id: clip.id,
          trackId: clip.trackId,
          name: clip.name,
          content: clip.content ?? '',
          sourceFrame,
          opacity: resolvedOpacity,
          zIndex,
          ...(clip.transform ? { transform: clip.transform } : {}),
          ...(clip.fontSize !== undefined ? { fontSize: clip.fontSize } : {}),
          ...(clip.color !== undefined ? { color: clip.color } : {}),
          ...(clip.fontFamily !== undefined ? { fontFamily: clip.fontFamily } : {}),
          ...(clip.fontWeight !== undefined ? { fontWeight: clip.fontWeight } : {}),
          ...(clip.textAlign !== undefined ? { textAlign: clip.textAlign } : {}),
        }
        scene.texts.push(active)
      } else if (clip.type === 'image' && clip.src) {
        const active: ActiveImageClip = {
          type: 'image',
          id: clip.id,
          trackId: clip.trackId,
          name: clip.name,
          src: clip.src,
          sourceFrame,
          opacity,
          zIndex,
          ...(clip.transform ? { transform: clip.transform } : {}),
        }
        scene.images.push(active)
      } else if (clip.type === 'shape' && clip.shapeKind) {
        let resolvedOpacity = opacity
        const sanim = clip.shapeAnimation
        if (sanim) {
          const d = Math.max(1, sanim.durationFrames)
          const localFrame = frame - clip.startFrame
          if (sanim.in === 'fade') {
            resolvedOpacity = Math.min(resolvedOpacity, Math.min(1, localFrame / d))
          }
          if (sanim.out === 'fade') {
            resolvedOpacity = Math.min(resolvedOpacity, Math.min(1, (clip.durationFrames - localFrame) / d))
          }
        }
        const active: ActiveShapeClip = {
          type: 'shape',
          id: clip.id,
          trackId: clip.trackId,
          name: clip.name,
          shapeKind: clip.shapeKind,
          shapeFill: clip.shapeFill ?? 'transparent',
          shapeStroke: clip.shapeStroke ?? '#ffffff',
          shapeStrokeWidth: clip.shapeStrokeWidth ?? 2,
          sourceFrame,
          opacity: resolvedOpacity,
          zIndex,
          ...(clip.transform ? { transform: clip.transform } : {}),
        }
        scene.shapes.push(active)
      } else if (clip.type === 'freehand') {
        const active: ActiveFreehandClip = {
          type: 'freehand',
          id: clip.id,
          trackId: clip.trackId,
          name: clip.name,
          pathData: clip.pathData ?? '',
          strokeColor: clip.strokeColor ?? '#ffffff',
          strokeWidth: clip.strokeWidth ?? 4,
          sourceFrame,
          opacity,
          zIndex,
          ...(clip.transform ? { transform: clip.transform } : {}),
        }
        scene.freehand.push(active)
      }
    }
  }

  // --- Transition pass -------------------------------------------------------
  // For each transition whose window contains `frame`:
  //   - fromClip.opacity = 0  → GPU skips it; TransitionOverlay shows a frozen
  //     snapshot fading away via CSS (preview) or globalAlpha=1-t (export).
  //   - toClip.opacity = 1    → GPU renders it fully; revealed as overlay fades.
  //
  // This eliminates decoder contention (only one clip decoded per frame) and
  // makes slide/wipe trivial (CSS transform on the snapshot div).
  // scene.transitions[] carries {t, kind, direction, fromClipId, toClipId} for
  // both TransitionOverlay (preview) and the export snapshot pass.

  for (const transition of project.transitions) {
    if (frame < transition.startFrame) continue
    if (frame >= transition.startFrame + transition.durationFrames) continue

    const rawT = (frame - transition.startFrame) / Math.max(1, transition.durationFrames)
    const t = applyEasing(rawT, transition.easing)

    const fromResult = findClipById(project.clips, transition.fromClipId)
    const toResult = findClipById(project.clips, transition.toClipId)
    if (!fromResult || !toResult) continue

    const { clip: fromClip } = fromResult
    const { clip: toClip } = toResult

    // zIndex: outgoing sits below incoming during the transition
    const fromZIndex = (maxOrder - (project.tracks.find((tr) => tr.id === transition.trackId)?.order ?? 0)) * 1000
    const toZIndex = fromZIndex + 1

    // Source frames — clamped so we never seek past the clip's source bounds.
    const fromSourceFrame = Math.min(
      Math.max(0, frame - fromClip.startFrame + fromClip.sourceStartFrame),
      fromClip.sourceDurationFrames - 1,
    )
    const toSourceFrame = Math.max(
      0,
      Math.min(
        frame - toClip.startFrame + toClip.sourceStartFrame,
        toClip.sourceDurationFrames - 1,
      ),
    )

    // fromClip: opacity=0 so GPU does not draw it (TransitionOverlay/export snapshot shows it).
    // toClip: opacity=1 so GPU renders it fully (revealed as the overlay fades away).
    const fromOpacity = 0
    const toOpacity = 1

    const toTrackMuted = project.tracks.find((tr) => tr.id === toClip.trackId)?.muted ?? false

    // Video clips
    if (fromClip.type === 'video' && fromClip.src) {
      const existing = scene.videos.find((v) => v.id === fromClip.id)
      if (existing) {
        existing.opacity = fromOpacity
        existing.sourceFrame = fromSourceFrame
      } else {
        scene.videos.push({
          type: 'video',
          id: fromClip.id,
          trackId: fromClip.trackId,
          name: fromClip.name,
          src: fromClip.src,
          sourceFrame: fromSourceFrame,
          opacity: fromOpacity,
          volume: 0,
          zIndex: fromZIndex,
          ...(fromClip.transform ? { transform: fromClip.transform } : {}),
        })
      }
    }
    if (toClip.type === 'video' && toClip.src) {
      const existing = scene.videos.find((v) => v.id === toClip.id)
      if (existing) {
        existing.opacity = toOpacity
        existing.sourceFrame = toSourceFrame
      } else {
        scene.videos.push({
          type: 'video',
          id: toClip.id,
          trackId: toClip.trackId,
          name: toClip.name,
          src: toClip.src,
          sourceFrame: toSourceFrame,
          opacity: toOpacity,
          volume: toTrackMuted ? 0 : (toClip.volume ?? 1),
          zIndex: toZIndex,
          ...(toClip.transform ? { transform: toClip.transform } : {}),
        })
      }
    }

    // Image clips
    if (fromClip.type === 'image' && fromClip.src) {
      const existing = scene.images.find((v) => v.id === fromClip.id)
      if (existing) {
        existing.opacity = fromOpacity
      } else {
        scene.images.push({
          type: 'image',
          id: fromClip.id,
          trackId: fromClip.trackId,
          name: fromClip.name,
          src: fromClip.src,
          sourceFrame: fromSourceFrame,
          opacity: fromOpacity,
          zIndex: fromZIndex,
          ...(fromClip.transform ? { transform: fromClip.transform } : {}),
        })
      }
    }
    if (toClip.type === 'image' && toClip.src) {
      const existing = scene.images.find((v) => v.id === toClip.id)
      if (existing) {
        existing.opacity = toOpacity
      } else {
        scene.images.push({
          type: 'image',
          id: toClip.id,
          trackId: toClip.trackId,
          name: toClip.name,
          src: toClip.src,
          sourceFrame: toSourceFrame,
          opacity: toOpacity,
          zIndex: toZIndex,
          ...(toClip.transform ? { transform: toClip.transform } : {}),
        })
      }
    }

    scene.transitions.push({
      id: transition.id,
      kind: transition.kind,
      t,
      direction: transition.direction,
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
    })
  }

  // Sort ascending by zIndex: lower values = further back = earlier in array.
  // Higher zIndex = front; the last element in each array renders on top.
  const byDepth = (a: { zIndex: number }, b: { zIndex: number }) =>
    a.zIndex - b.zIndex

  scene.videos.sort(byDepth)
  scene.audios.sort(byDepth)
  scene.texts.sort(byDepth)
  scene.images.sort(byDepth)

  return scene
}
