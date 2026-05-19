import { useEffect } from 'react'
import type { ClipType, TrackKind } from '../core/types'
import {
  MEDIA_DRAG_MIME,
  type DragMediaPayload,
  type MediaKind,
} from '../core/media/types'
import { useMediaLibraryStore } from '../core/media/store'
import { useTracksStore } from '../core/stores/tracks.store'
import { usePlaybackStore } from '../core/stores/playback.store'
import { buildSnapPoints, snapFrame } from '../core/utils/snap'
import { secondsToFrames } from '../core/utils/frames'
import { useTimeline } from './engine-context'

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

    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(MEDIA_DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(MEDIA_DRAG_MIME)) return
      e.preventDefault()

      let payload: DragMediaPayload
      try {
        payload = JSON.parse(
          e.dataTransfer.getData(MEDIA_DRAG_MIME),
        ) as DragMediaPayload
      } catch {
        return
      }

      if (payload.kind !== 'media-asset' || !payload.assetId) return

      const asset = useMediaLibraryStore.getState().getAsset(payload.assetId)
      if (!asset) return

      const tracks = useTracksStore.getState().tracks
      const track = tracks.find((t) => t.id === trackId)
      if (!track) return

      if (!isCompatibleTrackKind(track.kind, asset.kind)) return

      const zoom = usePlaybackStore.getState().zoom
      const snapEnabled = usePlaybackStore.getState().snapEnabled
      const currentFrame = usePlaybackStore.getState().currentFrame
      const project = engine.getProject()
      const fps = project.fps

      const rect = lane.getBoundingClientRect()
      let startFrame = Math.max(
        0,
        Math.round((e.clientX - rect.left) / zoom),
      )

      if (snapEnabled) {
        const allClips = useTracksStore.getState().clips
        const snapPoints = buildSnapPoints(allClips)
        snapPoints.push(currentFrame)
        const threshold = Math.max(1, Math.round(5 / zoom))
        startFrame = snapFrame(startFrame, snapPoints, threshold)
      }

      const durationFrames = Math.max(
        1,
        asset.durationSec > 0
          ? secondsToFrames(asset.durationSec, fps)
          : fps * 5,
      )

      engine.addClip({
        trackId,
        type: mediaKindToClipType(asset.kind),
        name: asset.name,
        startFrame,
        durationFrames,
        src: asset.src,
        assetId: asset.id,
      })
    }

    lane.addEventListener('dragover', handleDragOver)
    lane.addEventListener('drop', handleDrop)

    return () => {
      lane.removeEventListener('dragover', handleDragOver)
      lane.removeEventListener('drop', handleDrop)
    }
  }, [trackId, lane, engine])
}
