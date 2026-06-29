/**
 * @deprecated
 * `timelineTheme` is a backward-compat facade — its values now point at the
 * `--elah-*` CSS variable contract rather than raw hex literals. Components
 * no longer consume this object internally; they use Tailwind token classes
 * and `var(--elah-*)` directly.
 *
 * For per-instance visual overrides use the `classNames` prop on `<Timeline>`.
 * For global theming override the `--elah-*` custom properties on `.elah-root`.
 *
 * This export will be removed in a future major release.
 */
export const timelineTheme = {
  surface: {
    background:  'var(--elah-bg-secondary)',
    laneActive:  'var(--elah-bg-card)',
    sidebar:     'var(--elah-bg-panel)',
    sidebarActive: 'var(--elah-bg-elevated)',
  },

  border: {
    strong: 'var(--elah-border)',
    subtle: 'var(--elah-border-subtle)',
  },

  text: {
    primary:   'var(--elah-text)',
    bright:    'var(--elah-text)',
    secondary: 'var(--elah-text-muted)',
    muted:     'var(--elah-text-muted)',
    faint:     'var(--elah-tick-label)',
    disabled:  'var(--elah-text-muted)',
    hint:      'var(--elah-text-muted)',
    onClip:    'var(--elah-text-on-clip)',
  },

  clip: {
    video: {
      top:    'var(--elah-clip-video-top)',
      mid:    'var(--elah-clip-video-mid)',
      bottom: 'var(--elah-clip-video-bottom)',
      accent: 'var(--elah-clip-video-accent)',
    },
    audio: {
      top:    'var(--elah-clip-audio-top)',
      mid:    'var(--elah-clip-audio-mid)',
      bottom: 'var(--elah-clip-audio-bottom)',
      accent: 'var(--elah-clip-audio-accent)',
    },
    text: {
      top:    'var(--elah-clip-text-top)',
      mid:    'var(--elah-clip-text-mid)',
      bottom: 'var(--elah-clip-text-bottom)',
      accent: 'var(--elah-clip-text-accent)',
    },
    image: {
      top:    'var(--elah-clip-image-top)',
      mid:    'var(--elah-clip-image-mid)',
      bottom: 'var(--elah-clip-image-bottom)',
      accent: 'var(--elah-clip-image-accent)',
    },
  },

  selection: {
    border: 'var(--elah-selection-border)',
    glow:   'var(--elah-selection-glow)',
  },

  playhead: 'var(--elah-playhead)',

  ruler: {
    tick:  'var(--elah-tick-color)',
    label: 'var(--elah-tick-label)',
  },

  transition: {
    line:      'var(--elah-transition-line)',
    lineHover: 'var(--elah-transition-line-hover)',
    lineIdle:  'var(--elah-transition-line-idle)',
    fill:      'var(--elah-transition-fill)',
    stroke:    'var(--elah-transition-stroke)',
    addFill:   'var(--elah-transition-add-fill)',
    addStroke: 'var(--elah-transition-add-stroke)',
  },

  menu: {
    background: 'var(--elah-menu-bg)',
    border:     'var(--elah-menu-border)',
    shadow:     'var(--elah-menu-shadow)',
  },

  popover: {
    background:      'var(--elah-popover-bg)',
    border:          'var(--elah-popover-border)',
    shadow:          'var(--elah-popover-shadow)',
    optionBg:        'var(--elah-popover-option-bg)',
    optionBgHover:   'var(--elah-popover-option-bg-hover)',
    optionBgActive:  'var(--elah-popover-option-bg-active)',
    accent:          'var(--elah-popover-accent)',
    accentText:      'var(--elah-popover-accent-text)',
    icon:            'var(--elah-popover-icon)',
  },

  dialog: {
    overlay:          'var(--elah-dialog-overlay)',
    background:       'var(--elah-dialog-bg)',
    border:           'var(--elah-dialog-border)',
    shadow:           'var(--elah-dialog-shadow)',
    optionBg:         'var(--elah-dialog-option-bg)',
    optionBgHover:    'var(--elah-dialog-option-bg-hover)',
    optionBorder:     'var(--elah-dialog-option-border)',
    primaryBorder:    'var(--elah-dialog-primary-border)',
    primaryBg:        'var(--elah-dialog-primary-bg)',
    primaryBgHover:   'var(--elah-dialog-primary-bg-hover)',
  },

  danger: {
    text:     'var(--elah-danger-text)',
    textAlt:  'var(--elah-danger-text-alt)',
    bgHover:  'var(--elah-danger-bg-hover)',
    border:   'var(--elah-danger-border)',
  },

  effect: {
    gloss:                  'var(--elah-effect-gloss)',
    innerHighlight:         'var(--elah-effect-inner-highlight)',
    innerHighlightStrong:   'var(--elah-effect-inner-highlight-strong)',
    clipShadow:             'var(--elah-effect-clip-shadow)',
    tileSeparator:          'var(--elah-effect-tile-separator)',
    waveform:               'var(--elah-effect-waveform)',
    placeholderBg:          'var(--elah-effect-placeholder-bg)',
    placeholderBorder:      'var(--elah-effect-placeholder-border)',
    trimScrim:              'var(--elah-effect-trim-scrim)',
    labelShadow:            'var(--elah-effect-label-shadow)',
    deleteBtnBg:            'var(--elah-effect-delete-btn-bg)',
    deleteBtnBorder:        'var(--elah-effect-delete-btn-border)',
    deleteBtnText:          'var(--elah-effect-delete-btn-text)',
  },
} as const

export type TimelineTheme = typeof timelineTheme
