import type { PlaybackState, TrackKind, TracksState } from '@elah/core'

/**
 * Everything a gesture reducer may read, frozen when the gesture begins.
 *
 * It is a slice of the two core stores on purpose: `tracksStore` mirrors the
 * engine's project and `playbackStore` owns zoom and snapping, so a snapshot is
 * `{ ...tracksStore.getState(), ...playbackStore.getState() }` narrowed to the
 * fields below (`snapshotFromStores()` does exactly that). A reducer never reads
 * a store directly, which is what makes it testable without React or a device,
 * and is why the composition cannot change under a gesture in flight.
 */
export type GestureSnapshot = Pick<TracksState, 'tracks' | 'clips'> &
  Pick<PlaybackState, 'zoom' | 'snapEnabled'>

/**
 * One track lane's vertical slot in the lanes' own coordinate space (0 = top
 * of the first lane). The mobile equivalent of the DOM timeline measuring its
 * `[data-elah-lane]` rects at pointerdown, except computed from the track
 * list, so it is deterministic and needs no layout pass.
 */
export interface LaneSlot {
  trackId: string
  kind: TrackKind
  locked: boolean
  top: number
  bottom: number
  height: number
}

/** A clip block's rectangle in lane-content space (x grows with scroll offset applied by the caller). */
export interface ClipRect {
  x: number
  y: number
  width: number
  height: number
}
