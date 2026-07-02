import { useEffect } from 'react'
import {
  buildSnapPoints,
  MEDIA_DRAG_MIME,
  snapFrame,
  usePlaybackStore,
  useTracksStore,
  type DragMediaPayload,
} from '@elah/core'
import { ELEMENT_DRAG_MIME, type DragElementPayload } from './elementDrag'
import { useTimeline } from './engine-context'
import { insertElement, insertMediaAsset } from './insertAsset'

/**
 * Listen for drag-drop events on a timeline lane and delegate insertion to the
 * shared helper so pointer drops and tap activation use the same placement path.
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

    /** Pointer x -> timeline frame, snapped to clips + the playhead when enabled. */
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

    const dropMediaAsset = (e: DragEvent, desiredStartFrame: number) => {
      let payload: DragMediaPayload
      try {
        payload = JSON.parse(
          e.dataTransfer!.getData(MEDIA_DRAG_MIME),
        ) as DragMediaPayload
      } catch {
        return
      }

      if (payload.kind !== 'media-asset' || !payload.assetId) return
      void insertMediaAsset(engine, payload.assetId, {
        desiredStartFrame,
        targetTrackId: trackId,
      })
    }

    const dropElement = (e: DragEvent, desiredStartFrame: number) => {
      let payload: DragElementPayload
      try {
        payload = JSON.parse(
          e.dataTransfer!.getData(ELEMENT_DRAG_MIME),
        ) as DragElementPayload
      } catch {
        return
      }

      insertElement(engine, payload, {
        desiredStartFrame,
        targetTrackId: trackId,
      })
    }

    const handleDrop = (e: DragEvent) => {
      if (!acceptsDrag(e)) return
      e.preventDefault()

      const track = useTracksStore
        .getState()
        .tracks.find((t) => t.id === trackId)
      if (!track) return
      if (track.locked) return // locked tracks reject new clips

      // clientX must be read before any await in the insertion helper.
      const desiredStartFrame = startFrameAt(e.clientX)
      if (e.dataTransfer!.types.includes(ELEMENT_DRAG_MIME)) {
        dropElement(e, desiredStartFrame)
      } else {
        dropMediaAsset(e, desiredStartFrame)
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
