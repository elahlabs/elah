import { useEffect } from 'react'

/**
 * Listen for media drag-drop events on a timeline lane and create clips.
 *
 * Implementation deferred to PR-09. Until then this hook is a documented
 * no-op so the asset-gallery PR can wire up to a stable import without
 * waiting for the drop handler to be built.
 *
 * @param trackId  The id of the track this lane represents.
 * @param lane     The DOM element to attach drop listeners to (e.g. the lane's content div).
 *                 Pass `null` while the ref is not yet mounted — the hook handles it safely.
 */
export function useTimelineDrop(trackId: string, lane: HTMLElement | null): void {
  useEffect(() => {
    // TODO: PR-09 — listen for `MEDIA_DRAG_MIME` payloads on `lane`,
    // compute drop frame from x-offset and zoom, and call engine.addClip.
    void trackId
    void lane
  }, [trackId, lane])
}
