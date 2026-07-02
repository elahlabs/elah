/**
 * @elah/timeline
 *
 * Reusable timeline UI framework.
 * Consumes @elah/core. Must not depend on @elah/editor.
 * Independently installable.
 */

// --- Timeline UI ---
export { Timeline } from './Timeline'
export type { TimelineProps, TimelineRef } from './Timeline'
export type { TimelineClassNames } from './classNames'

// --- Timeline hooks ---
export { useTimeline } from './engine-context'
export { useTracks } from './hooks/useTracks'
export { usePlayback } from './hooks/usePlayback'
export { useSelection } from './hooks/useSelection'
export { useTimelineDrop } from './useTimelineDrop'
export { insertMediaAsset, insertElement } from './insertAsset'
export type {
  InsertAssetOptions,
  InsertAssetResult,
  InsertAssetFailureReason,
  InsertedKind,
} from './insertAsset'

// --- Element drag infrastructure (public API) ---
export { ELEMENT_DRAG_MIME } from './elementDrag'
export type { DragElementPayload, ElementKind, ShapeVariant } from './elementDrag'

// --- Styling util — merge classNames so a passed class wins over defaults ---
export { cn } from './cn'

// --- Backward-compat theme facade (@deprecated — use classNames prop or --elah-* CSS vars) ---
export { timelineTheme } from './theme'
export type { TimelineTheme } from './theme'
