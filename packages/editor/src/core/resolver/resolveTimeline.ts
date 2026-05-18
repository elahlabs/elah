import type { Project } from '../types'
import type {
  Scene,
  ActiveVideoClip,
  ActiveAudioClip,
  ActiveTextClip,
  ActiveImageClip,
} from './scene'

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

    const zIndex = (maxOrder - track.order) * 1000

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
        const active: ActiveTextClip = {
          type: 'text',
          id: clip.id,
          trackId: clip.trackId,
          name: clip.name,
          content: clip.content ?? '',
          sourceFrame,
          opacity,
          zIndex,
          ...(clip.transform ? { transform: clip.transform } : {}),
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
