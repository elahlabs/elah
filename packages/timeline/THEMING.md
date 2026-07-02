# @elah/timeline — Theming Guide

Three supported ways to style the timeline, ordered from most to least recommended.

---

## 1. CSS variables (recommended)

Override `--elah-*` custom properties on `.elah-root` (or any ancestor) in your own stylesheet. Changes apply globally to every timeline instance.

```css
/* your-theme.css */
.elah-root {
  /* accent — drives the playhead, selection chrome, and focus rings */
  --elah-accent: #6366f1; /* indigo */
  --elah-accent-hover: #818cf8;
  --elah-accent-dim: #a5b4fc;
  --elah-accent-glow: rgba(99, 102, 241, 0.35);
  --elah-accent-soft: rgba(99, 102, 241, 0.12);

  /* surfaces */
  --elah-bg: #0f0f0f;
  --elah-bg-secondary: #141414;
  --elah-bg-panel: #1a1a1a;
  --elah-bg-card: #161616;
  --elah-bg-elevated: #222222;

  /* playhead */
  --elah-playhead: #6366f1;

  /* clip bodies — video track (indigo) */
  --elah-clip-video-top: #6366f1;
  --elah-clip-video-mid: #4f46e5;
  --elah-clip-video-bottom: #3730a3;
  --elah-clip-video-accent: #818cf8;

  /* clip bodies — audio track (emerald) */
  --elah-clip-audio-top: #10b981;
  --elah-clip-audio-mid: #059669;
  --elah-clip-audio-bottom: #047857;
  --elah-clip-audio-accent: #34d399;
}
```

```tsx
import '@elah/timeline/styles.css'
import '@elah/editor/styles/tokens.css' // baseline defaults
import './your-theme.css' // your overrides

;<div className="elah-root">
  {/* Timeline reads engine + playback from EditorContext — see the README quick start */}
  <Timeline />
</div>
```

Full token reference: [docs/design-tokens.md](../../docs/design-tokens.md).

---

## 2. Per-instance `classNames` prop

Pass a `classNames` map to override one specific `<Timeline>` without affecting others. Each value is a Tailwind class string merged on top of the built-in defaults via `tailwind-merge`.

```tsx
<Timeline
  classNames={{
    // structural slots
    root: 'rounded-xl border border-zinc-800',
    ruler: 'bg-zinc-900',
    rulerTick: 'bg-zinc-700',
    rulerLabel: 'text-zinc-500 font-mono',
    lane: 'bg-zinc-950',
    trackLabel: 'bg-zinc-900 text-zinc-300',

    // clip shape (all types share this)
    clip: 'rounded-lg shadow-lg',

    // per-type clip body — gradient stops or a solid bg-*
    clipVideo: 'from-indigo-500 to-indigo-700',
    clipAudio: 'from-emerald-600 to-emerald-800',
    clipText: 'from-orange-500 to-orange-700',
    clipImage: 'from-amber-400 to-amber-600',

    // per-type accent — recolor the left stripe, selection border,
    // and track-label bar. Must be a text-* class (they paint from currentColor).
    clipVideoAccent: 'text-indigo-300',
    clipAudioAccent: 'text-emerald-400',
    clipTextAccent: 'text-orange-300',
    clipImageAccent: 'text-amber-300',

    // playhead needle — also a text-* class (paints from currentColor)
    playhead: 'text-indigo-400',
  }}
/>
```

---

## 3. `timelineTheme` object — backward compat only

> **Deprecated.** This API exists so packages that imported `timelineTheme` before the CSS-var migration continue to compile. It will be removed in a future major release. For new code use option 1 or 2 above.

The object is still exported from `@elah/timeline`, but its values now resolve to `var(--elah-*)` strings instead of raw hex literals — so reading a property gives you the live CSS variable reference, not a hardcoded color.

```ts
import { timelineTheme } from '@elah/timeline'

// Reading a value returns the CSS variable string, not a hex.
console.log(timelineTheme.clip.video.accent)
// → 'var(--elah-clip-video-accent)'

// Useful for applying to an inline style:
<div style={{ borderColor: timelineTheme.clip.video.accent }} />
// Equivalent to:
<div style={{ borderColor: 'var(--elah-clip-video-accent)' }} />
```

If you previously used `timelineTheme` to build your own style object and apply it to the timeline, the migration path is:

```tsx
// Before (old — timelineTheme had hex literals)
<div style={{
  background: timelineTheme.surface.background,   // was '#0A0D14'
  color:      timelineTheme.text.primary,          // was '#F3F4F6'
}}>

// After — option A: keep timelineTheme (still works, now resolves to var())
<div style={{
  background: timelineTheme.surface.background,   // now 'var(--elah-bg-secondary)'
  color:      timelineTheme.text.primary,          // now 'var(--elah-text)'
}}>

// After — option B: reference CSS vars directly (preferred)
<div style={{
  background: 'var(--elah-bg-secondary)',
  color:      'var(--elah-text)',
}}>

// After — option C: use the classNames prop for timeline slots
<Timeline
  classNames={{ root: 'bg-[--elah-bg-secondary] text-[--elah-text]' }}
/>
```

### Token map

| `timelineTheme` path                 | CSS variable                                |
| ------------------------------------ | ------------------------------------------- |
| `surface.background`                 | `--elah-bg-secondary`                       |
| `surface.laneActive`                 | `--elah-bg-card`                            |
| `surface.sidebar`                    | `--elah-bg-panel`                           |
| `surface.sidebarActive`              | `--elah-bg-elevated`                        |
| `border.strong`                      | `--elah-border`                             |
| `border.subtle`                      | `--elah-border-subtle`                      |
| `text.primary`                       | `--elah-text`                               |
| `text.secondary` / `text.muted`      | `--elah-text-muted`                         |
| `text.faint`                         | `--elah-tick-label`                         |
| `text.onClip`                        | `--elah-text-on-clip`                       |
| `clip.video.{top,mid,bottom,accent}` | `--elah-clip-video-{top,mid,bottom,accent}` |
| `clip.audio.{top,mid,bottom,accent}` | `--elah-clip-audio-{top,mid,bottom,accent}` |
| `clip.text.{top,mid,bottom,accent}`  | `--elah-clip-text-{top,mid,bottom,accent}`  |
| `clip.image.{top,mid,bottom,accent}` | `--elah-clip-image-{top,mid,bottom,accent}` |
| `selection.border`                   | `--elah-selection-border`                   |
| `selection.glow`                     | `--elah-selection-glow`                     |
| `playhead`                           | `--elah-playhead`                           |
| `ruler.tick`                         | `--elah-tick-color`                         |
| `ruler.label`                        | `--elah-tick-label`                         |
| `transition.line`                    | `--elah-transition-line`                    |
| `transition.lineHover`               | `--elah-transition-line-hover`              |
| `transition.lineIdle`                | `--elah-transition-line-idle`               |
| `menu.background`                    | `--elah-menu-bg`                            |
| `menu.border`                        | `--elah-menu-border`                        |
| `menu.shadow`                        | `--elah-menu-shadow`                        |
| `danger.text`                        | `--elah-danger-text`                        |
| `danger.bgHover`                     | `--elah-danger-bg-hover`                    |
| `effect.waveform`                    | `--elah-effect-waveform`                    |
| `effect.clipShadow`                  | `--elah-effect-clip-shadow`                 |
