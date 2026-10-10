import type { ClipType } from '@elah/core'

/**
 * Colours for the mobile timeline until a theming issue exists. React Native
 * has no CSS variables, so these are the dark `.elah-root` defaults of the
 * `--elah-*` tokens (packages/editor/src/styles/tokens.css), copied by value.
 * Clip bodies use the same mid / bottom tone per type as the web
 * `DEFAULT_CLIP_BG` in packages/timeline/src/ClipBlock.tsx.
 */
export const timelineColors = {
  /** --elah-bg-secondary: the lanes. */
  laneBackground: '#0a0d14',
  /** --elah-bg-panel: the track-label column. */
  labelBackground: '#121722',
  /** --elah-border: lane separators. */
  border: '#232938',
  /** --elah-text */
  text: '#f3f4f6',
  /** --elah-text-muted */
  textMuted: '#9ca3af',
  /** --elah-text-on-clip */
  textOnClip: 'rgba(255, 255, 255, 0.95)',
  /** --elah-selection-border */
  selection: '#00c2ff',
  /** --elah-bg-panel: the ruler strip (the web ruler uses `bg-ed-panel`). */
  rulerBackground: '#121722',
  /** --elah-tick-color: ruler tick marks. */
  tick: '#394146',
  /** --elah-tick-label: ruler timecode labels. */
  tickLabel: '#7a858b',
  /** --elah-playhead: the playhead needle (white by default on web). */
  playhead: '#ffffff',
  /** --elah-clip-<type>-{mid|bottom} as body, --elah-clip-<type>-accent as the left stripe. */
  clip: {
    video: { body: '#2563eb', accent: '#60a5fa' },
    audio: { body: '#0c2a26', accent: '#0d4d3c' },
    text: { body: '#7a2e10', accent: '#ad5621' },
    image: { body: '#d97706', accent: '#fcd34d' },
    shape: { body: '#4f46e5', accent: '#a5b4fc' },
    freehand: { body: '#059669', accent: '#6ee7b7' },
  } satisfies Record<ClipType, { body: string; accent: string }>,
} as const

export type TimelineColors = typeof timelineColors
