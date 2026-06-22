/**
 * @deprecated Superseded by the --elah-* CSS variable contract; see tokens.css.
 * This object is kept for backward compatibility only. Components now use
 * Tailwind utility classes (static styles) and `var(--elah-*)` (dynamic styles).
 * Do not add new uses of `timelineTheme` in components.
 *
 * Timeline design tokens — the single place to recolor the entire timeline UI.
 *
 * Every color, border, shadow and overlay used by the timeline components is
 * defined here and nowhere else. Components import `timelineTheme` instead of
 * inlining literals, so changing the look of the whole timeline (e.g. a light
 * theme, or matching a host app's brand) means editing this one object — no
 * hunting through component files.
 *
 * Grouping is by role, not by component, so a token is reused wherever the same
 * visual meaning applies (a "muted text" color is one token, not five copies).
 */
export const timelineTheme = {
  /** Background fills for the structural surfaces (lanes, sidebar, ruler). */
  surface: {
    /** Outer timeline background and the default (inactive) clip lane. */
    background: '#0A0D14',
    /** Clip lane of the currently active track. */
    laneActive: '#0D1017',
    /** Track-label sidebar and ruler spacer (inactive). */
    sidebar: '#121722',
    /** Track-label sidebar of the active track. */
    sidebarActive: '#171D2B',
  },

  /** Hairline dividers between rows, lanes and the sidebar. */
  border: {
    /** Stronger vertical rule (sidebar edge, ruler ticks). */
    strong: '#232938',
    /** Subtler horizontal rule between track rows. */
    subtle: '#1A1F2B',
  },

  /** Foreground text colors, brightest → faintest. */
  text: {
    /** Primary labels (active track, headings). */
    primary: '#F3F4F6',
    /** Slightly brighter body text inside menus/dialogs. */
    bright: '#E5E7EB',
    /** Inactive track label. */
    secondary: '#A7AFBF',
    /** Secondary/meta text (hints, slider labels). */
    muted: '#9CA3AF',
    /** Ruler labels and section captions. */
    faint: '#6B7280',
    /** Empty-state placeholder copy. */
    disabled: '#555555',
    /** Smallest helper captions (slider end labels). */
    hint: '#4B5563',
    /** Text rendered on top of a colored clip body. */
    onClip: 'rgba(255,255,255,0.95)',
  },

  /**
   * Per-clip-type color ramp. `top`→`mid`→`bottom` form the vertical body
   * gradient; `accent` is the left stripe and selected-border tint.
   */
  clip: {
    video: { top: '#3B82F6', mid: '#2563EB', bottom: '#1D4ED8', accent: '#60A5FA' },
    audio: { top: '#22C55E', mid: '#16A34A', bottom: '#15803D', accent: '#4ADE80' },
    text: { top: '#A855F7', mid: '#9333EA', bottom: '#7E22CE', accent: '#C084FC' },
    image: { top: '#FBBF24', mid: '#D97706', bottom: '#B45309', accent: '#FCD34D' },
  },

  /** Selected-clip highlight (border + outer glow). */
  selection: {
    border: '#FF2D55',
    glow: 'rgba(255, 45, 85, 0.4)',
  },

  /** Playhead needle (line, handle, glow all share this color). */
  playhead: '#FF2D55',

  /** Ruler tick marks and timecode labels. */
  ruler: {
    tick: '#232938',
    label: '#6B7280',
  },

  /** Transition cut-line and diamond marker on track rows. */
  transition: {
    /** Cut line when a transition exists. */
    line: 'rgba(107, 140, 255, 0.9)',
    /** Cut line on hover (no transition yet). */
    lineHover: 'rgba(255,255,255,0.55)',
    /** Cut line at rest (no transition, not hovered). */
    lineIdle: 'rgba(255,255,255,0.18)',
    /** Filled diamond when a transition exists. */
    fill: '#6B8CFF',
    stroke: '#A5B4FC',
    /** Outline-only "add" diamond (no transition). */
    addFill: 'rgba(255,255,255,0.12)',
    addStroke: 'rgba(255,255,255,0.7)',
  },

  /** Clip right-click context menu. */
  menu: {
    background: '#1E2433',
    border: '#2D3548',
    shadow: '0 8px 24px rgba(0,0,0,0.5)',
  },

  /** Transition picker popover. */
  popover: {
    background: '#1A1F2B',
    border: '#2D3548',
    shadow: '0 8px 32px rgba(0,0,0,0.6)',
    /** Kind-option button: idle / hover / selected backgrounds. */
    optionBg: '#232938',
    optionBgHover: '#2D3548',
    optionBgActive: '#3B4A6B',
    /** Selected option border + slider accent. */
    accent: '#6B8CFF',
    /** Selected option label text. */
    accentText: '#A5B4FC',
    /** Option icon/label when idle. */
    icon: '#9CA3AF',
  },

  /** Blocking "this video has audio" choice dialog. */
  dialog: {
    overlay: 'rgba(5, 7, 12, 0.6)',
    background: '#171D2B',
    border: '#232938',
    shadow: '0 24px 60px rgba(0,0,0,0.55)',
    /** Secondary choice button: idle / hover bg + border. */
    optionBg: '#1B2230',
    optionBgHover: '#222B3C',
    optionBorder: '#2A3142',
    /** Primary (recommended) choice button. */
    primaryBorder: '#2563EB',
    primaryBg: 'rgba(37, 99, 235, 0.16)',
    primaryBgHover: 'rgba(37, 99, 235, 0.28)',
  },

  /** Destructive actions (delete clip / remove transition). */
  danger: {
    text: '#FF6B6B',
    textAlt: '#F87171',
    bgHover: 'rgba(255,107,107,0.12)',
    border: '#3F2A2A',
  },

  /**
   * Reusable light/dark overlays composited over colored surfaces — glosses,
   * inset highlights, scrims and drop shadows. Kept here so the whole UI's
   * "depth" can be tuned in one place.
   */
  effect: {
    /** Top gloss highlight gradient start. */
    gloss: 'rgba(255,255,255,0.14)',
    /** Inset top highlight on a clip body. */
    innerHighlight: 'rgba(255,255,255,0.12)',
    /** Inset top highlight on a selected clip body. */
    innerHighlightStrong: 'rgba(255,255,255,0.15)',
    /** Clip drop shadow. */
    clipShadow: '0 2px 6px rgba(0,0,0,0.35)',
    /** Right-edge separator between filmstrip tiles. */
    tileSeparator: 'rgba(0,0,0,0.28)',
    /** Audio waveform bars. */
    waveform: 'rgba(255,255,255,0.85)',
    /** Filmstrip placeholder box fill + border. */
    placeholderBg: 'rgba(0,0,0,0.22)',
    placeholderBorder: 'rgba(255,255,255,0.08)',
    /** Trim-handle edge scrim (fades to transparent). */
    trimScrim: 'rgba(0,0,0,0.35)',
    /** Label drop shadow for legibility over bright clips. */
    labelShadow: '0 1px 2px rgba(0,0,0,0.45)',
    /** Inline delete-button chrome on a selected clip. */
    deleteBtnBg: 'rgba(0,0,0,0.5)',
    deleteBtnBorder: 'rgba(255,255,255,0.35)',
    deleteBtnText: '#ffffff',
  },
} as const

export type TimelineTheme = typeof timelineTheme
