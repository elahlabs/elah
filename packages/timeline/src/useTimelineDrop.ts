import { useEffect, useState } from 'react'
import {
  buildSnapPoints,
  MEDIA_DRAG_MIME,
  mediaDragKindMime,
  snapFrame,
  playbackStore,
  tracksStore,
  type DragMediaPayload,
  type MediaKind,
  type TrackKind,
} from '@elah/core'
import { ELEMENT_DRAG_MIME, type DragElementPayload } from './elementDrag'
import { useTimeline } from './engine-context'
import { insertElement, insertMediaAsset } from './insertAsset'

/** Whether a media asset can be placed on a track of the given kind. */
function isCompatibleTrackKind(trackKind: TrackKind, mediaKind: MediaKind): boolean {
  if (trackKind === 'audio') return mediaKind === 'audio'
  if (trackKind === 'video') return mediaKind === 'video' || mediaKind === 'image'
  return false
}

const MEDIA_KINDS: MediaKind[] = ['video', 'audio', 'image']

/**
 * Read the dragged asset's `MediaKind` off `dataTransfer.types`, which (unlike
 * `getData`) is readable during dragenter/dragover in every browser. Drags
 * that predate the kind marker (or came from outside the app) fall back to
 * `null`, treated as "unknown, allow it" by the caller.
 */
function mediaKindFromDragTypes(types: DOMStringList | readonly string[]): MediaKind | null {
  for (const kind of MEDIA_KINDS) {
    if (Array.prototype.includes.call(types, mediaDragKindMime(kind))) return kind
  }
  return null
}

/**
 * Whether the drag currently over `track` is a legal drop: not a locked
 * track, and a media/element kind the track actually accepts.
 */
function isDropAllowed(e: DragEvent, track: { kind: TrackKind; locked?: boolean }): boolean {
  if (track.locked) return false
  const types = e.dataTransfer?.types
  if (!types) return false
  if (types.includes(ELEMENT_DRAG_MIME)) return track.kind === 'elements'
  if (types.includes(MEDIA_DRAG_MIME)) {
    const kind = mediaKindFromDragTypes(types)
    if (!kind) return true
    return isCompatibleTrackKind(track.kind, kind)
  }
  return false
}

/**
 * Drag-over state of a track lane, for highlighting the drop target:
 * `'valid'` — a compatible drag is hovering (accent highlight), `'invalid'` —
 * an incompatible drag or a locked track (red highlight), `null` — no drag.
 */
export type TimelineDropState = 'valid' | 'invalid' | null

/**
 * Listen for drag-drop events on a timeline lane and delegate insertion to the
 * shared helper so pointer drops and tap activation use the same placement path.
 *
 * @param trackId  The id of the track this lane represents.
 * @param lane     The DOM element to attach drop listeners to (e.g. the lane's content div).
 *                 Pass `null` while the ref is not yet mounted — the hook handles it safely.
 * @returns The lane's current drag-over state — used to highlight the drop
 *          target so it's obvious where (and whether) the drop will land.
 */
export function useTimelineDrop(trackId: string, lane: HTMLElement | null): TimelineDropState {
  const engine = useTimeline()
  const [dropState, setDropState] = useState<TimelineDropState>(null)

  useEffect(() => {
    if (!lane) return

    // dragenter/dragleave also fire for child elements (clip blocks) inside the
    // lane, so a plain enter→true / leave→false toggle flickers as the pointer
    // crosses child boundaries. A depth counter only clears the highlight once
    // the pointer has actually left the lane subtree.
    let dragDepth = 0

    const acceptsDrag = (e: DragEvent) =>
      e.dataTransfer?.types.includes(MEDIA_DRAG_MIME) ||
      e.dataTransfer?.types.includes(ELEMENT_DRAG_MIME)

    /** Pointer x -> timeline frame, snapped to clips + the playhead when enabled. */
    const startFrameAt = (clientX: number): number => {
      const zoom = playbackStore.getState().zoom
      const rect = lane.getBoundingClientRect()
      let startFrame = Math.max(0, Math.round((clientX - rect.left) / zoom))

      if (playbackStore.getState().snapEnabled) {
        const allClips = tracksStore.getState().clips
        const snapPoints = buildSnapPoints(allClips)
        snapPoints.push(playbackStore.getState().currentFrame)
        const threshold = Math.max(1, Math.round(5 / zoom))
        startFrame = snapFrame(startFrame, snapPoints, threshold)
      }
      return startFrame
    }

    const handleDragOver = (e: DragEvent) => {
      if (!acceptsDrag(e)) return
      const track = tracksStore.getState().tracks.find((t) => t.id === trackId)
      if (!track || !isDropAllowed(e, track)) {
        // Not a legal drop here (locked track or incompatible kind) — show the
        // no-drop cursor and, by not calling preventDefault, let the browser
        // reject the drop.
        e.dataTransfer!.dropEffect = 'none'
        return
      }
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }

    const handleDragEnter = (e: DragEvent) => {
      if (!acceptsDrag(e)) return
      const track = tracksStore.getState().tracks.find((t) => t.id === trackId)
      dragDepth += 1
      setDropState(track && isDropAllowed(e, track) ? 'valid' : 'invalid')
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!acceptsDrag(e)) return
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) setDropState(null)
    }

    const resetDragState = () => {
      dragDepth = 0
      setDropState(null)
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
      resetDragState()

      const track = tracksStore
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
    lane.addEventListener('dragenter', handleDragEnter)
    lane.addEventListener('dragleave', handleDragLeave)
    lane.addEventListener('drop', handleDrop)

    return () => {
      lane.removeEventListener('dragover', handleDragOver)
      lane.removeEventListener('dragenter', handleDragEnter)
      lane.removeEventListener('dragleave', handleDragLeave)
      lane.removeEventListener('drop', handleDrop)
      resetDragState()
    }
  }, [trackId, lane, engine])

  return dropState
}
