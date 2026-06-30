import { useEffect } from 'react'
import type { ClipType, TrackKind } from '@elah/core'
import {
  MEDIA_DRAG_MIME,
  type DragMediaPayload,
  type MediaAsset,
  type MediaKind,
} from '@elah/core'
import { useAudioDropDialogStore } from './audioDropDialog.store'
import { ELEMENT_DRAG_MIME, type DragElementPayload } from './elementDrag'
import { useMediaLibraryStore } from '@elah/core'
import { useTracksStore } from '@elah/core'
import { usePlaybackStore } from '@elah/core'
import { buildSnapPoints, snapFrame } from '@elah/core'
import { secondsToFrames, clipsOverlap } from '@elah/core'
import { useTimeline } from './engine-context'

/** Default on-timeline length for a freshly dropped text block, in seconds. */
const DEFAULT_TEXT_DURATION_SEC = 3

/**
 * Resolve a drop position so the new clip never overlaps an existing one.
 *
 * - If there's no overlap at desiredStart → returns unchanged.
 * - If the drop lands in a gap that's too small for the clip → trims to fill
 *   exactly that gap (bug 4).
 * - If the drop lands on top of an existing clip → pushes start to just after
 *   the last overlapping clip, trimming if the next clip immediately follows
 *   (bugs 2 & 3).
 */
function resolveDropPosition(
  existingClips: { startFrame: number; durationFrames: number }[],
  desiredStart: number,
  durationFrames: number,
): { startFrame: number; durationFrames: number } {
  const sorted = [...existingClips].sort((a, b) => a.startFrame - b.startFrame)

  const overlapping = sorted.filter((c) =>
    clipsOverlap(c, { startFrame: desiredStart, durationFrames }),
  )

  if (overlapping.length === 0) return { startFrame: desiredStart, durationFrames }

  const firstOverlap = overlapping[0]

  // desiredStart is in a gap but the clip extends into the next clip → trim to gap
  if (desiredStart < firstOverlap.startFrame) {
    const prevEnd = Math.max(
      0,
      ...sorted
        .filter((c) => c.startFrame + c.durationFrames <= desiredStart)
        .map((c) => c.startFrame + c.durationFrames),
    )
    const gapSize = firstOverlap.startFrame - prevEnd
    return { startFrame: prevEnd, durationFrames: Math.min(durationFrames, gapSize) }
  }

  // desiredStart is inside an existing clip → push to after all overlapping clips
  const lastOverlapEnd = Math.max(
    ...overlapping.map((c) => c.startFrame + c.durationFrames),
  )
  const nextClip = sorted.find((c) => c.startFrame >= lastOverlapEnd)
  if (nextClip) {
    const available = nextClip.startFrame - lastOverlapEnd
    return { startFrame: lastOverlapEnd, durationFrames: Math.min(durationFrames, available) }
  }
  return { startFrame: lastOverlapEnd, durationFrames }
}

/** Map MediaAsset kind to ClipType (identical for video/audio/image). */
function mediaKindToClipType(kind: MediaKind): ClipType {
  return kind
}

/** Whether a media asset can be placed on a track of the given kind. */
function isCompatibleTrackKind(trackKind: TrackKind, mediaKind: MediaKind): boolean {
  if (trackKind === 'audio') return mediaKind === 'audio'
  if (trackKind === 'video') return mediaKind === 'video' || mediaKind === 'image'
  return false
}

/**
 * Listen for media drag-drop events on a timeline lane and create clips.
 *
 * @param trackId  The id of the track this lane represents.
 * @param lane     The DOM element to attach drop listeners to (e.g. the lane's content div).
 *                 Pass `null` while the ref is not yet mounted — the hook handles it safely.
 */
export function useTimelineDrop(trackId: string, lane: HTMLElement | null): void {
  const engine = useTimeline()

  useEffect(() => {
    if (!lane) return

    const acceptsDrag = (e: DragEvent) =>
      e.dataTransfer?.types.includes(MEDIA_DRAG_MIME) ||
      e.dataTransfer?.types.includes(ELEMENT_DRAG_MIME)

    /** Pointer x → timeline frame, snapped to clips + the playhead when enabled. */
    const startFrameAt = (clientX: number): number => {
      const zoom = usePlaybackStore.getState().zoom
      const rect = lane.getBoundingClientRect()
      let startFrame = Math.max(0, Math.round((clientX - rect.left) / zoom))

      if (usePlaybackStore.getState().snapEnabled) {
        const allClips = useTracksStore.getState().clips
        const snapPoints = buildSnapPoints(allClips)
        snapPoints.push(usePlaybackStore.getState().currentFrame)
        const threshold = Math.max(1, Math.round(5 / zoom))
        startFrame = snapFrame(startFrame, snapPoints, threshold)
      }
      return startFrame
    }

    const handleDragOver = (e: DragEvent) => {
      if (!acceptsDrag(e)) return
      // A locked track refuses new clips — show the no-drop cursor and, by not
      // calling preventDefault, let the browser reject the drop.
      const track = useTracksStore.getState().tracks.find((t) => t.id === trackId)
      if (track?.locked) {
        e.dataTransfer!.dropEffect = 'none'
        return
      }
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }

    /** Find the first audio track, creating one if none exists. */
    const ensureAudioTrack = (): string => {
      const existing = useTracksStore
        .getState()
        .tracks.find((t) => t.kind === 'audio')
      return existing ? existing.id : engine.addTrack('audio').id
    }

    /** Resolve a non-overlapping placement for `desired` on a track. */
    const resolveOn = (tid: string, desired: number, dur: number) =>
      resolveDropPosition(useTracksStore.getState().clips[tid] ?? [], desired, dur)

    /** Add one media clip. MediaKind is never 'text', so `src` is always valid. */
    const addMediaClip = (
      tid: string,
      type: 'video' | 'audio' | 'image',
      asset: MediaAsset,
      startFrame: number,
      durationFrames: number,
    ) => {
      engine.addClip({
        trackId: tid,
        type,
        name: asset.name,
        startFrame,
        durationFrames,
        src: asset.src,
        assetId: asset.id,
      })
    }

    const dropMediaAsset = async (e: DragEvent, track: { kind: TrackKind }) => {
      let payload: DragMediaPayload
      try {
        payload = JSON.parse(
          e.dataTransfer!.getData(MEDIA_DRAG_MIME),
        ) as DragMediaPayload
      } catch {
        return
      }

      if (payload.kind !== 'media-asset' || !payload.assetId) return

      const asset = useMediaLibraryStore.getState().getAsset(payload.assetId)
      if (!asset) return
      if (!isCompatibleTrackKind(track.kind, asset.kind)) return

      const fps = engine.getProject().fps
      const fullDuration = Math.max(
        1,
        asset.durationSec > 0 ? secondsToFrames(asset.durationSec, fps) : fps * 5,
      )
      // clientX must be read before any await — the DragEvent is dead afterwards.
      const desiredStart = startFrameAt(e.clientX)

      // Only a video that actually carries audio prompts; everything else keeps
      // the original single-clip behaviour (no regression for audio/image/silent video).
      if (asset.kind !== 'video' || !asset.hasAudio) {
        const r = resolveOn(trackId, desiredStart, fullDuration)
        addMediaClip(
          trackId,
          mediaKindToClipType(asset.kind) as 'video' | 'audio' | 'image',
          asset,
          r.startFrame,
          r.durationFrames,
        )
        return
      }

      const choice = await useAudioDropDialogStore.getState().request(asset.name)
      if (!choice) return // superseded by a newer drop

      engine.batch(() => {
        if (choice === 'video-only') {
          const v = resolveOn(trackId, desiredStart, fullDuration)
          addMediaClip(trackId, 'video', asset, v.startFrame, v.durationFrames)
        } else if (choice === 'both') {
          // Resolve against BOTH tracks at once so the pair lands where neither
          // track is occupied — they stay frame-synced and never overlap.
          // (Linked-clip ripple edits are a deferred follow-on.)
          const audioTrackId = ensureAudioTrack()
          const videoClips = useTracksStore.getState().clips[trackId] ?? []
          const audioClips = useTracksStore.getState().clips[audioTrackId] ?? []
          const r = resolveDropPosition(
            [...videoClips, ...audioClips],
            desiredStart,
            fullDuration,
          )
          addMediaClip(trackId, 'video', asset, r.startFrame, r.durationFrames)
          addMediaClip(audioTrackId, 'audio', asset, r.startFrame, r.durationFrames)
        } else {
          // audio-only: resolve independently against the audio track.
          const audioTrackId = ensureAudioTrack()
          const a = resolveOn(audioTrackId, desiredStart, fullDuration)
          addMediaClip(audioTrackId, 'audio', asset, a.startFrame, a.durationFrames)
        }
      }, 'Add media')
    }

    const dropElement = (e: DragEvent, track: { kind: TrackKind }) => {
      let payload: DragElementPayload
      try {
        payload = JSON.parse(
          e.dataTransfer!.getData(ELEMENT_DRAG_MIME),
        ) as DragElementPayload
      } catch {
        return
      }

      // All synthetic elements live on 'elements' tracks.
      if (track.kind !== 'elements') return

      const fps = engine.getProject().fps
      const existing = useTracksStore.getState().clips[trackId] ?? []
      const n = existing.length + 1
      const elemDuration = Math.max(1, fps * DEFAULT_TEXT_DURATION_SEC)
      const { startFrame, durationFrames } =
        resolveDropPosition(existing, startFrameAt(e.clientX), elemDuration)

      if (payload.element === 'text') {
        engine.addClip({
          trackId,
          type: 'text',
          name: `Text ${n}`,
          startFrame,
          durationFrames,
          text: {
            content: `Text ${n}`,
            fontSize: 200,
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontWeight: 'normal',
            textAlign: 'center',
          },
        })
        return
      }

      if (payload.element === 'shape') {
        const shapeKind = payload.shapeVariant ?? 'rect'
        engine.addClip({
          trackId,
          type: 'shape',
          name: `${shapeKind.charAt(0).toUpperCase() + shapeKind.slice(1)} ${n}`,
          startFrame,
          durationFrames,
          shape: {
            shapeKind,
            shapeFill: '#4f9cf9',
            shapeStroke: 'transparent',
            shapeStrokeWidth: 0,
          },
        })
        return
      }

      if (payload.element === 'freehand') {
        engine.addClip({
          trackId,
          type: 'freehand',
          name: `Drawing ${n}`,
          startFrame,
          durationFrames,
          freehand: {
            pathData: '',
            strokeColor: '#ffffff',
            strokeWidth: 4,
          },
        })
      }
    }

    const handleDrop = (e: DragEvent) => {
      if (!acceptsDrag(e)) return
      e.preventDefault()

      const track = useTracksStore
        .getState()
        .tracks.find((t) => t.id === trackId)
      if (!track) return
      if (track.locked) return // locked tracks reject new clips

      if (e.dataTransfer!.types.includes(ELEMENT_DRAG_MIME)) {
        dropElement(e, track)
      } else {
        // Fire-and-forget: all DragEvent reads happen synchronously before the
        // first await inside dropMediaAsset.
        void dropMediaAsset(e, track)
      }
    }

    lane.addEventListener('dragover', handleDragOver)
    lane.addEventListener('drop', handleDrop)

    return () => {
      lane.removeEventListener('dragover', handleDragOver)
      lane.removeEventListener('drop', handleDrop)
    }
  }, [trackId, lane, engine])
}


