/**
 * Discriminated union returned by every editor action.
 *
 * Actions never throw on expected failure (no selection, playhead out of
 * bounds, etc.) — they return a tagged result so callers must handle the
 * failure case explicitly. Use `result.ok` to narrow.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; reason: ActionFailureReason }

export type ActionFailureReason =
  | 'no-selection'
  | 'multi-selection'
  | 'clip-not-found'
  | 'playhead-outside-clip'
  | 'engine-rejected'
  | 'cannot-split-while-playing'
  | 'track-locked'
  // PV-T1
  | 'not-adjacent'
  | 'media-limit'
  | 'not-slippable'
  | 'no-main-track'
  // AVM-P5
  | 'no-audio-to-detach'
  | 'no-audio-track'
