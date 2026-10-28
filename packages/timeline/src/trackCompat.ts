/**
 * Track / clip compatibility rules moved to `@elah/core`
 * (`utils/timelineMath.ts`) so the drop gate, the insertion path and the
 * React Native "Add to timeline" button share one definition. This module is
 * kept so the internal import sites do not change.
 */
export { isCompatibleTrackKind, isClipAllowedOnTrack } from '@elah/core'
