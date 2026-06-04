import { useEffect } from 'react'
import type { ClipType, TrackKind } from '../core/types'
import {
  MEDIA_DRAG_MIME,
  type DragMediaPayload,
  type MediaKind,
} from '../core/assets/types'
import { ELEMENT_DRAG_MIME, type DragElementPayload } from './elementDrag'
import { useMediaLibraryStore } from '../core/assets/store'
import { useTracksStore } from '../core/stores/tracks.store'
import { usePlaybackStore } from '../core/stores/playback.store'
import { buildSnapPoints, snapFrame } from '../core/utils/snap'
import { secondsToFrames } from '../core/utils/frames'
import { useTimeline } from './engine-context'

/** Default on-timeline length for a freshly dropped text block, in seconds. */
const DEFAULT_TEXT_DURATION_SEC = 3

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
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }

    const dropMediaAsset = (e: DragEvent, track: { kind: TrackKind }) => {
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
      const durationFrames = Math.max(
        1,
        asset.durationSec > 0
          ? secondsToFrames(asset.durationSec, fps)
          : fps * 5,
      )

      // MediaKind is 'video' | 'audio' | 'image' — never 'text', so `src` is
      // always the right shape. The assertion below collapses the union for TS.
      engine.addClip({
        trackId,
        type: mediaKindToClipType(asset.kind) as 'video' | 'audio' | 'image',
        name: asset.name,
        startFrame: startFrameAt(e.clientX),
        durationFrames,
        src: asset.src,
        assetId: asset.id,
      })
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

      // Only text elements exist today, and they only belong on text tracks.
      if (payload.element !== 'text' || track.kind !== 'text') return

      const fps = engine.getProject().fps
      const existing = useTracksStore.getState().clips[trackId] ?? []
      const n = existing.length + 1
      engine.addClip({
        trackId,
        type: 'text',
        name: `Text ${n}`,
        startFrame: startFrameAt(e.clientX),
        durationFrames: Math.max(1, fps * DEFAULT_TEXT_DURATION_SEC),
        text: {
          content: `Text ${n}`,
          fontSize: 200,
          color: '#ffffff',
          fontFamily: 'sans-serif',
          fontWeight: 'normal',
          textAlign: 'center',
        },
      })
    }

    const handleDrop = (e: DragEvent) => {
      if (!acceptsDrag(e)) return
      e.preventDefault()

      const track = useTracksStore
        .getState()
        .tracks.find((t) => t.id === trackId)
      if (!track) return

      if (e.dataTransfer!.types.includes(ELEMENT_DRAG_MIME)) {
        dropElement(e, track)
      } else {
        dropMediaAsset(e, track)
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
