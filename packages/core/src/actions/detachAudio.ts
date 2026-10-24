/**
 * Merged A/V (AVM-P5): split a video clip's sound out onto its own audio lane,
 * and the strict inverse.
 *
 * Both run inside ONE `engine.batch`, which defers the `change` emit until the
 * outermost batch ends. That is what keeps the resolver from ever seeing the
 * window where the embedded audio and the new audio clip both exist (double
 * sound). "They still edit together" is not built here: `linkClips` writes the
 * shared `linkId` and `expandLinked`, `splitLinked` and the UI's `withLinked`
 * already honour it.
 */

import type { Clip, Project } from '../types'
import type { TimelineEngine } from '../editor/TimelineEngine'
import { findFreeTrackAt } from './tracks'
import { expandLinked } from './links'
import type { ActionResult } from './types'

export interface DetachAudioData {
  audioClipId: string
  trackId: string
  linkId: string
}

function clipIn(project: Project, clipId: string): { clip: Clip; trackId: string } | undefined {
  for (const [trackId, clips] of Object.entries(project.clips)) {
    const clip = clips.find((c) => c.id === clipId)
    if (clip) return { clip, trackId }
  }
  return undefined
}

/** Only the volume channel means anything on an audio clip. */
function volumeKeyframes(clip: Clip): Clip['keyframes'] | undefined {
  const track = clip.keyframes?.channels.volume
  if (!track) return undefined
  return { channels: { volume: structuredClone(track) } }
}

export function detachClipAudio(engine: TimelineEngine, clipId: string): ActionResult<DetachAudioData> {
  const found = engine.findClip(clipId)
  if (!found) return { ok: false, reason: 'clip-not-found' }
  const { clip } = found
  if (engine.isTrackLocked(found.trackId)) return { ok: false, reason: 'track-locked' }
  if (clip.type !== 'video' || clip.embeddedAudio !== true || !clip.src) {
    return { ok: false, reason: 'no-audio-to-detach' }
  }

  // Every audio lane locked: adding another would route around the user's lock.
  const audioLanes = engine.getProject().tracks.filter((t) => t.kind === 'audio')
  if (audioLanes.length > 0 && audioLanes.every((t) => t.locked)) return { ok: false, reason: 'no-audio-track' }

  let result: DetachAudioData | null = null
  engine.batch(() => {
    // `addClip` throws on overlap, so an unlocked lane is not enough: it must
    // be free across the clip's span. No such lane (none exist, or the open
    // ones are busy here) means a new one, made inside this same undo step.
    const trackId =
      findFreeTrackAt(engine, 'audio', clip.startFrame, clip.durationFrames)?.id ?? engine.addTrack('audio').id

    const audio = engine.addClip({
      trackId,
      type: 'audio',
      src: clip.src as string,
      ...(clip.assetId !== undefined ? { assetId: clip.assetId } : {}),
      name: clip.name,
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
      volume: clip.volume ?? 1,
    })
    const keyframes = volumeKeyframes(clip)
    engine.updateClip(audio.id, trackId, {
      sourceStartFrame: clip.sourceStartFrame,
      sourceDurationFrames: clip.sourceDurationFrames,
      ...(clip.assetFrames !== undefined ? { assetFrames: clip.assetFrames } : {}),
      ...(clip.speed !== undefined ? { speed: clip.speed } : {}),
      ...(keyframes ? { keyframes } : {}),
    })
    const linkId = engine.linkClips([clip.id, audio.id])
    if (!linkId) throw new Error('detachClipAudio: link failed')
    engine.updateClip(clip.id, found.trackId, { embeddedAudio: false })
    result = { audioClipId: audio.id, trackId, linkId }
  }, 'Split audio and video')

  if (!result) return { ok: false, reason: 'engine-rejected' }
  return { ok: true, data: result }
}

/**
 * The audio clip that `reattachClipAudio` would merge back into `videoClipId`,
 * or `undefined` when the merge is not unambiguous: the link group must hold
 * exactly one audio clip, and it must still be an untouched copy of the
 * video's own sound (same source, position, trim window, speed, level, and no
 * volume keys the video lacks). Once any of that changed there is no
 * defensible merge, so the answer is "not available", never a guess.
 */
export function reattachCandidate(project: Project, videoClipId: string): Clip | undefined {
  const found = clipIn(project, videoClipId)
  if (!found) return undefined
  const video = found.clip
  if (video.type !== 'video' || video.embeddedAudio !== false || !video.linkId) return undefined
  const group = expandLinked(project, [videoClipId]).filter((id) => id !== videoClipId)
  const partners = group.map((id) => clipIn(project, id)?.clip).filter((c): c is Clip => !!c)
  const audio = partners.filter((c) => c.type === 'audio')
  if (audio.length !== 1) return undefined
  const a = audio[0]!
  const sameSource = a.assetId !== undefined || video.assetId !== undefined ? a.assetId === video.assetId : a.src === video.src
  if (!sameSource || a.src !== video.src) return undefined
  if (
    a.startFrame !== video.startFrame ||
    a.durationFrames !== video.durationFrames ||
    a.sourceStartFrame !== video.sourceStartFrame ||
    (a.speed ?? 1) !== (video.speed ?? 1) ||
    (a.volume ?? 1) !== (video.volume ?? 1)
  ) {
    return undefined
  }
  const av = JSON.stringify(a.keyframes?.channels.volume ?? null)
  const vv = JSON.stringify(video.keyframes?.channels.volume ?? null)
  if (av !== vv) return undefined
  return a
}

export function canReattachAudio(project: Project, videoClipId: string): boolean {
  return reattachCandidate(project, videoClipId) !== undefined
}

export function reattachClipAudio(engine: TimelineEngine, videoClipId: string): ActionResult<{ removedAudioClipId: string }> {
  const found = engine.findClip(videoClipId)
  if (!found) return { ok: false, reason: 'clip-not-found' }
  const audio = reattachCandidate(engine.getProject(), videoClipId)
  if (!audio) return { ok: false, reason: 'no-audio-to-detach' }
  if (engine.isTrackLocked(found.trackId) || engine.isTrackLocked(audio.trackId)) {
    return { ok: false, reason: 'track-locked' }
  }
  engine.batch(() => {
    engine.removeClip(audio.id, audio.trackId)
    engine.updateClip(videoClipId, found.trackId, { embeddedAudio: true })
    engine.unlinkClips([videoClipId])
  }, 'Merge audio back into clip')
  return { ok: true, data: { removedAudioClipId: audio.id } }
}
