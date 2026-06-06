import type { Project, Clip, TransitionEasing } from '../types'
import type {
  Scene,
  ActiveVideoClip,
  ActiveAudioClip,
  ActiveTextClip,
  ActiveImageClip,
} from './scene'

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
    transitions: [],
  }

  // --- Solo pre-pass ---------------------------------------------------------
  // If any track of a given kind is solo'd, only that track (or those tracks)
  // will contribute clips. Image clips live on video tracks and share solo rules.
  const hasSolo = { video: false, audio: false, text: false }
  for (const t of project.tracks) {
    if (t.solo) {
      if (t.kind === 'video' || t.kind === 'audio' || t.kind === 'text') {
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
    if (hasSolo[track.kind as 'video' | 'audio' | 'text'] && !track.solo) continue

    const clips = project.clips[track.id]
    if (!clips || clips.length === 0) continue

    const zIndex = track.kind === 'text' ? 1000000 : (maxOrder - track.order) * 1000

    for (const clip of clips) {
      if (clip.disabled) continue
      if (frame < clip.startFrame) continue
      if (frame >= clip.startFrame + clip.durationFrames) continue

      // How far into the source asset we are at this frame.
      const sourceFrame = frame - clip.startFrame + clip.sourceStartFrame
      const opacity = clip.opacity ?? 1
      const baseVolume = clip.volume ?? 1
      const volume = track.muted ? 0 : baseVolume

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
      }
    }
  }

  // --- Transition pass -------------------------------------------------------
  // For each transition whose window contains `frame`, synthesize overlap:
  // both the outgoing (fromClip) and incoming (toClip) are rendered simultaneously
  // with opposing opacities. The normal clip loop above may have added one of them
  // already; we modify its opacity in-place and push the other if absent.
  //
  // For fade: this is sufficient — both renderers consume opacity automatically.
  // For slide/wipe (future): scene.transitions carries `kind + t` for TransitionOverlay.

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

    // Correct crossfade compositing (source-over):
    //   result = t * toColor + (1-t) * fromColor
    // Draw fromClip at full opacity as the base layer, then toClip at opacity=t
    // on top. source-over in both WebGL and canvas-2D then yields the exact
    // formula above — no black-bleed or brightness dip at the transition midpoint.
    // Setting fromOpacity = (1-t) would give t*to + (1-t)²*from (wrong: dark midpoint).
    const fromOpacity = fromClip.opacity ?? 1   // base layer — always full
    const toOpacity = (toClip.opacity ?? 1) * t // fades in on top

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

    // Emit the active transition descriptor so TransitionOverlay (slide/wipe) can read it.
    scene.transitions.push({
      id: transition.id,
      kind: transition.kind,
      t,
      direction: transition.direction,
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
