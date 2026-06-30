'use client'

import { memo } from 'react'

/**
 * Theme mode for the timeline config panel.
 *
 * Implements the "CSS variables" path from packages/timeline/THEMING.md: pick a
 * handful of colours, and the rest of the `--elah-*` contract is derived from
 * them (gradient shades, accent tints, rgba glows). Emits two things:
 *   • a derived `--elah-*` map the parent applies inline to `.elah-root` (live)
 *   • the same map rendered as `.elah-root { … }` CSS + the render snippet
 *
 * State is owned by the parent (so it survives tab switches) — this component is
 * controlled via `values` / `onChange`.
 */

// ── hex helpers ──────────────────────────────────────────────────────────────
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const hexToRgb = (hex: string): [number, number, number] =>
  [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16)) as [number, number, number]
const rgbToHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((n) => clamp(n).toString(16).padStart(2, '0')).join('')
/** Mix toward white (amt > 0) or black (amt < 0). */
const shade = (hex: string, amt: number) => {
  const [r, g, b] = hexToRgb(hex)
  const t = amt < 0 ? 0 : 255
  const a = Math.abs(amt)
  return rgbToHex([r + (t - r) * a, g + (t - g) * a, b + (t - b) * a])
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

// ── tokens ───────────────────────────────────────────────────────────────────
interface ThemeToken {
  id: string
  label: string
  def: string
  /** One picked colour → the `--elah-*` vars it drives. */
  emit: (v: string) => Record<string, string>
}

const single = (cssVar: string) => (v: string) => ({ [cssVar]: v })
const clip = (key: string) => (v: string) => ({
  [`--elah-clip-${key}-top`]: shade(v, 0.12),
  [`--elah-clip-${key}-mid`]: v,
  [`--elah-clip-${key}-bottom`]: shade(v, -0.16),
  [`--elah-clip-${key}-accent`]: shade(v, 0.3),
})

interface ThemeGroup {
  title: string
  tokens: ThemeToken[]
}

export const THEME_GROUPS: ThemeGroup[] = [
  {
    title: 'Accent',
    tokens: [
      {
        id: 'accent',
        label: 'Accent',
        def: '#00c2ff',
        emit: (v) => ({
          '--elah-accent': v,
          '--elah-accent-hover': shade(v, 0.18),
          '--elah-accent-dim': shade(v, 0.4),
          '--elah-accent-glow': rgba(v, 0.35),
          '--elah-accent-soft': rgba(v, 0.12),
        }),
      },
      {
        id: 'selection',
        label: 'Selection',
        def: '#00c2ff',
        emit: (v) => ({ '--elah-selection-border': v, '--elah-selection-glow': rgba(v, 0.4) }),
      },
      { id: 'playhead', label: 'Playhead', def: '#ffffff', emit: single('--elah-playhead') },
    ],
  },
  {
    title: 'Clips',
    tokens: [
      { id: 'clipVideo', label: 'Video', def: '#2563eb', emit: clip('video') },
      { id: 'clipAudio', label: 'Audio', def: '#115843', emit: clip('audio') },
      { id: 'clipText', label: 'Text', def: '#8f3f18', emit: clip('text') },
      { id: 'clipImage', label: 'Image', def: '#d97706', emit: clip('image') },
    ],
  },
  {
    title: 'Surfaces',
    tokens: [
      { id: 'bg', label: 'Base', def: '#06070a', emit: single('--elah-bg') },
      { id: 'bgSecondary', label: 'Timeline', def: '#0a0d14', emit: single('--elah-bg-secondary') },
      { id: 'bgPanel', label: 'Panel', def: '#121722', emit: single('--elah-bg-panel') },
      { id: 'bgCard', label: 'Card', def: '#0d1017', emit: single('--elah-bg-card') },
      { id: 'bgElevated', label: 'Elevated', def: '#171d2b', emit: single('--elah-bg-elevated') },
    ],
  },
  {
    title: 'Text & Ruler',
    tokens: [
      { id: 'text', label: 'Text', def: '#f3f4f6', emit: single('--elah-text') },
      { id: 'textMuted', label: 'Muted', def: '#9ca3af', emit: single('--elah-text-muted') },
      { id: 'tickColor', label: 'Ticks', def: '#394146', emit: single('--elah-tick-color') },
      { id: 'tickLabel', label: 'Tick labels', def: '#7a858b', emit: single('--elah-tick-label') },
    ],
  },
]

const ALL_TOKENS = THEME_GROUPS.flatMap((g) => g.tokens)

export const DEFAULT_THEME_VALUES: Record<string, string> = Object.fromEntries(
  ALL_TOKENS.map((t) => [t.id, t.def]),
)

/** Derive the `--elah-*` override map — only vars whose source colour changed. */
export function buildThemeVars(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const token of ALL_TOKENS) {
    const v = values[token.id]
    if (v && v !== token.def) Object.assign(out, token.emit(v))
  }
  return out
}

/**
 * The `--elah-*` tokens the TIMELINE actually consumes (per
 * packages/timeline/THEMING.md and the `timelineTheme` facade in
 * packages/timeline/src/theme.ts). Editor-only tokens — preview/stage, panel
 * tag chips, info toasts, semantic error — are intentionally excluded so the
 * Code output is a focused timeline theme, not the whole editor sheet.
 */
const TIMELINE_THEME_CSS = `.elah-root {
  /* ── Surfaces ─────────────────────────────────────────────────────────── */
  --elah-bg:            #06070a;
  --elah-bg-secondary:  #0a0d14;
  --elah-bg-panel:      #121722;
  --elah-bg-card:       #0d1017;
  --elah-bg-elevated:   #171d2b;
  --elah-bg-highest:    #1e2433;

  /* ── Borders ──────────────────────────────────────────────────────────── */
  --elah-border:        #232938;
  --elah-border-subtle: #1a1f2b;

  /* ── Text ─────────────────────────────────────────────────────────────── */
  --elah-text:          #f3f4f6;
  --elah-text-muted:    #9ca3af;
  --elah-text-on-clip:  rgba(255, 255, 255, 0.95);

  /* ── Accent (playhead chrome, selection, focus) ───────────────────────── */
  --elah-accent:        #00c2ff;
  --elah-accent-hover:  #2bcbff;
  --elah-accent-dim:    #7adcff;
  --elah-accent-glow:   rgba(0, 194, 255, 0.35);
  --elah-accent-soft:   rgba(0, 194, 255, 0.12);

  /* ── Playhead & ruler ─────────────────────────────────────────────────── */
  --elah-playhead:      #ffffff;
  --elah-tick-color:    #394146;
  --elah-tick-label:    #7a858b;

  /* ── Selection ────────────────────────────────────────────────────────── */
  --elah-selection-border: #00c2ff;
  --elah-selection-glow:   rgba(0, 194, 255, 0.4);

  /* ── Clip colours — video ─────────────────────────────────────────────── */
  --elah-clip-video-top:    #3b82f6;
  --elah-clip-video-mid:    #2563eb;
  --elah-clip-video-bottom: #1d4ed8;
  --elah-clip-video-accent: #60a5fa;

  /* ── Clip colours — audio ─────────────────────────────────────────────── */
  --elah-clip-audio-top:    #1c8160;
  --elah-clip-audio-mid:    #115843;
  --elah-clip-audio-bottom: #0c2a26;
  --elah-clip-audio-accent: #0d4d3c;

  /* ── Clip colours — text ──────────────────────────────────────────────── */
  --elah-clip-text-top:    #ad5621;
  --elah-clip-text-mid:    #8f3f18;
  --elah-clip-text-bottom: #7a2e10;
  --elah-clip-text-accent: #ad5621;

  /* ── Clip colours — image ─────────────────────────────────────────────── */
  --elah-clip-image-top:    #fbbf24;
  --elah-clip-image-mid:    #d97706;
  --elah-clip-image-bottom: #b45309;
  --elah-clip-image-accent: #fcd34d;

  /* ── Clip colours — shape (indigo) ───────────────────────────────────── */
  --elah-clip-shape-top:    #818cf8;
  --elah-clip-shape-mid:    #6366f1;
  --elah-clip-shape-bottom: #4f46e5;
  --elah-clip-shape-accent: #a5b4fc;

  /* ── Clip colours — freehand (teal-green) ────────────────────────────── */
  --elah-clip-freehand-top:    #34d399;
  --elah-clip-freehand-mid:    #10b981;
  --elah-clip-freehand-bottom: #059669;
  --elah-clip-freehand-accent: #6ee7b7;

  /* ── Typography ───────────────────────────────────────────────────────── */
  --elah-font-ui:   system-ui, -apple-system, 'Segoe UI', sans-serif;
  --elah-font-mono: ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, monospace;

  /* ── Transitions (crossfade chips) ────────────────────────────────────── */
  --elah-transition-line:       rgba(107, 140, 255, 0.9);
  --elah-transition-line-hover: rgba(255, 255, 255, 0.55);
  --elah-transition-line-idle:  rgba(255, 255, 255, 0.18);
  --elah-transition-fill:       #3c3e94;
  --elah-transition-stroke:     #525480;
  --elah-transition-add-fill:   rgba(255, 255, 255, 0.12);
  --elah-transition-add-stroke: rgba(255, 255, 255, 0.7);

  /* ── Context menu ─────────────────────────────────────────────────────── */
  --elah-menu-bg:     #1e2433;
  --elah-menu-border: #2d3548;
  --elah-menu-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);

  /* ── Transition picker popover ────────────────────────────────────────── */
  --elah-popover-bg:               #1a1f2b;
  --elah-popover-border:           #2d3548;
  --elah-popover-shadow:           0 8px 32px rgba(0, 0, 0, 0.6);
  --elah-popover-option-bg:        #232938;
  --elah-popover-option-bg-hover:  #2d3548;
  --elah-popover-option-bg-active: #3b4a6b;
  --elah-popover-accent:           #6b8cff;
  --elah-popover-accent-text:      #a5b4fc;
  --elah-popover-icon:             #9ca3af;

  /* ── Audio-drop dialog ────────────────────────────────────────────────── */
  --elah-dialog-overlay:          rgba(5, 7, 12, 0.6);
  --elah-dialog-bg:               #171d2b;
  --elah-dialog-border:           #232938;
  --elah-dialog-shadow:           0 24px 60px rgba(0, 0, 0, 0.55);
  --elah-dialog-option-bg:        #1b2230;
  --elah-dialog-option-bg-hover:  #222b3c;
  --elah-dialog-option-border:    #2a3142;
  --elah-dialog-primary-border:   #2563eb;
  --elah-dialog-primary-bg:       rgba(37, 99, 235, 0.16);
  --elah-dialog-primary-bg-hover: rgba(37, 99, 235, 0.28);

  /* ── Danger (delete) ──────────────────────────────────────────────────── */
  --elah-danger-text:     #ff6b6b;
  --elah-danger-text-alt: #f87171;
  --elah-danger-bg-hover: rgba(255, 107, 107, 0.12);
  --elah-danger-border:   #3f2a2a;

  /* ── Clip effects ─────────────────────────────────────────────────────── */
  --elah-effect-gloss:                  rgba(255, 255, 255, 0.04);
  --elah-effect-inner-highlight:        rgba(255, 255, 255, 0.04);
  --elah-effect-inner-highlight-strong: rgba(255, 255, 255, 0.06);
  --elah-effect-clip-shadow:            0 1px 2px rgba(0, 0, 0, 0.25);
  --elah-effect-tile-separator:         rgba(0, 0, 0, 0.28);
  --elah-effect-waveform:               rgba(255, 255, 255, 0.85);
  --elah-effect-placeholder-bg:         rgba(0, 0, 0, 0.22);
  --elah-effect-placeholder-border:     rgba(255, 255, 255, 0.08);
  --elah-effect-trim-scrim:             rgba(0, 0, 0, 0.35);
  --elah-effect-label-shadow:           0 1px 2px rgba(0, 0, 0, 0.45);
  --elah-effect-delete-btn-bg:          rgba(0, 0, 0, 0.5);
  --elah-effect-delete-btn-border:      rgba(255, 255, 255, 0.35);
  --elah-effect-delete-btn-text:        #ffffff;
}

.elah-root [data-clip-type='audio'] {
  --elah-effect-waveform: #248f6c;
}
.elah-root [data-clip-type='audio'][data-selected='true'] {
  --elah-clip-audio-top:    #2b4a82;
  --elah-clip-audio-mid:    #1d3460;
  --elah-clip-audio-bottom: #162245;
  --elah-clip-audio-accent: #4370b2;
  --elah-effect-waveform:   #4370b2;
}`

/**
 * The timeline token sheet with overrides merged in. Each override replaces the
 * FIRST declaration of that var (inside the main `.elah-root` block), leaving
 * the audio selected-state rule intact.
 */
export function buildThemeCss(vars: Record<string, string>): string {
  let css = TIMELINE_THEME_CSS
  for (const [name, value] of Object.entries(vars)) {
    css = css.replace(new RegExp(`(${name}\\s*:\\s*)[^;]*;`), `$1${value};`)
  }
  return css
}

export const THEME_RENDER_CODE = `// Replace @elah/editor/styles/tokens.css with the full sheet above,
// or import it after to override.
import './tokens.css'
import '@elah/timeline/styles.css'
import { EditorProvider, Timeline } from '@elah/editor'

export function ThemedTimeline() {
  return (
    <div className="elah-root">
      <EditorProvider fps={30}>
        <Timeline fps={30} />
      </EditorProvider>
    </div>
  )
}`

function ColorRow({ token, value, onChange }: { token: ThemeToken; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer group">
      <span className="text-[11px] text-ed-text-muted group-hover:text-ed-text transition-colors">
        {token.label}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-ed-text-muted tabular-nums uppercase">{value}</span>
        <span
          className="relative h-5 w-5 rounded-md border border-ed-border overflow-hidden shadow-sm"
          style={{ background: value }}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={token.label}
          />
        </span>
      </span>
    </label>
  )
}

interface TimelineThemeModeProps {
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
}

export const TimelineThemeMode = memo(function TimelineThemeMode({ values, onChange }: TimelineThemeModeProps) {
  const vars = buildThemeVars(values)
  const dirty = Object.keys(vars).length > 0

  const setToken = (id: string, v: string) => onChange({ ...values, [id]: v })
  const reset = () => onChange({ ...DEFAULT_THEME_VALUES })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-ed-text-muted/70 leading-snug max-w-[180px]">
          CSS-variable theming. Shades & glows derive from each colour.
        </p>
        {dirty && (
          <button
            onClick={reset}
            className="text-[9px] text-ed-text-muted hover:text-ed-text uppercase tracking-wide cursor-pointer shrink-0"
          >
            reset
          </button>
        )}
      </div>

      {THEME_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-ed-text-muted/50">
            {group.title}
          </span>
          {group.tokens.map((token) => (
            <ColorRow key={token.id} token={token} value={values[token.id] ?? token.def} onChange={(v) => setToken(token.id, v)} />
          ))}
        </div>
      ))}
    </div>
  )
})
