/**
 * Anchored-zoom arithmetic moved to `@elah/core` (`utils/timelineMath.ts`),
 * where it is tested once and shared with the React Native timeline's pinch
 * gesture. This module is kept so the internal import sites do not change.
 */
export { computeAnchoredScrollLeft, resolveZoomAnchorX, wheelZoomStep } from '@elah/core'
