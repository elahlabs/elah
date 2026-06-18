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

// --- Design tokens (single source of truth for timeline colors) ---
export { timelineTheme } from './theme'
export type { TimelineTheme } from './theme'

// --- Timeline hooks ---
export { useTimeline } from './engine-context'
export { useTracks } from './hooks/useTracks'
export { usePlayback } from './hooks/usePlayback'
export { useSelection } from './hooks/useSelection'
export { useTimelineDrop } from './useTimelineDrop'

// --- Element drag infrastructure (public API) ---
export { ELEMENT_DRAG_MIME } from './elementDrag'
export type { DragElementPayload, ElementKind } from './elementDrag'
