# Timeline redesign — Figma spec (self-contained)

Reference for the timeline redesign on `feat/design-improvements`.
**Self-contained: everything needed to implement is in this file + the committed screenshots.
No Figma re-query required.**

Color values are **exact** — sampled from the rendered screenshot with ImageMagick
(dominant color per region), because the Figma MCP returned structure-only metadata for this
node (no style/Code Connect data). Geometry is exact from Figma metadata.

## Source

- **File:** `time-line (Copy)` — `https://www.figma.com/design/PRGuzFDbbOLaIZsr8VXQD0/time-line--Copy-?node-id=278-2503`
- **Screen frame:** `Desktop - 2` (`278:2503`), 1440×900 — full editor mock
- **Target node:** `Timeline Section` (`271:2059`), 1368×344 at (72, 556)
- **Screenshots (committed in-repo):**
  - `docs/assets/timeline-redesign/full-editor.png` — full editor
  - `docs/assets/timeline-redesign/timeline.png` — timeline only (1368×344, 1:1 with Figma px)

## Decision (locked — FINAL: applied globally)

> **Applied globally** (the isolated `/playground/figma` route + `figma-theme.css` were removed —
> shared component edits were needed anyway, so isolation gave nothing). The Figma look is now
> THE theme. Old theme recoverable via git history only.
>
> **App accent = cyan `#00c2ff`** (Figma Export button / active tab / slider thumb — confirmed
> from the full-editor crop; the purple was the avatar circle, not a button). Follow the Figma
> colors faithfully (no preserving crimson).
>
> Files changed:
> - `apps/web/styles/globals.css` — `.elah-root` token values (accent, playhead, ticks, text/audio
>   clips, transition, selection, stage border) + two audio `data-*` retint rules.
> - `packages/editor/src/styles/tokens.css` — synced standalone defaults to match + same rules.
> - `packages/timeline/src/ClipBlock.tsx` — added inert `data-clip-type` / `data-selected` hooks.
> - Packages rebuilt (`npm run build:packages`) so `apps/web` (which consumes `dist/`) reflects it.
>
> Mechanism for the audio states: `from-clip-audio-*` utilities resolve `var(--elah-clip-audio-*)`
> at runtime; the `[data-clip-type='audio'][data-selected='true']` rule overrides those vars on the
> clip element so the gradient repaints blue, and `--elah-effect-waveform` cascades to the bars.

## Layout & geometry (exact, from Figma)

```
Timeline Section            1368 × 344
├─ Timeline Toolbar         1368 × 48
└─ Timeline Content         1368 × 295
   ├─ Track Headers col      192 wide
   │  └─ rows               ~32 each
   └─ Lanes / Ruler          1176 wide   (1368 − 192)
```

- Ruler strip ≈ **32px**; track row ≈ **32px**; 8 rows visible.
- Panel plate `Rectangle 31` (`288:2505`) sits behind the whole section.

## Toolbar (`271:2060`, 48h)

`[+ Add Track] [T Add Text Track] | [Split] [Crop] [Delete] [Duplicate] [History] [Split@playhead]
………………………………………………… [Mic] [Snap] [Fit]  [− ⚪——— +] (zoom)`

- Buttons are ghost (icon + text). Vertical divider after the two add-buttons (`271:2071`, 1×16).
- Zoom slider thumb is **blue** (the only obvious accent in the timeline).

## Ruler + playhead

- Numeric counters every ~30 units: `00:00 00:30 00:60 00:90 … 00:330` (raw counter, **not**
  normalized MM:SS — `00:60`, not `01:00`).
- **Playhead: solid WHITE needle** + small white flag at the ruler.

## Track headers (left 192px)

`[type icon] [name] … [visibility] [lock]`

| Row | Type icon | Visibility control |
|-----|-----------|--------------------|
| Text Track 2 / 1 | `T` glyph | eye + lock |
| Video Track 3 / 2 / 1 | film/clapper | eye + lock |
| Audio Track 1 / 2 / 3 | music note | **speaker (volume)** + lock |

## Exact colors (sampled, srgb hex)

### Surfaces — cool near-black navy
| Region | Sampled | rgb |
|--------|---------|-----|
| Lane / track area | `#101217` | 16,18,23 |
| Toolbar | `#111318` | 17,19,24 |
| Ruler / header strip | `#0E1418` | 14,20,24 |

### Ruler / playhead
| Part | Sampled |
|------|---------|
| Timecode label (gray) | `#7A858B` |
| Tick mark | `#394146` |
| **Playhead needle** | `#FFFFFF` |

### Clips
| Clip | Body | Waveform / accent / border |
|------|------|----------------------------|
| **Text** (orange/rust) | `#7A2E10` | top highlight `#AD5621` |
| **Video — effect** ("Chrom…room", indigo) | `#232356` | border/accent `#3C3E94`, lighter `#525480` |
| **Video — media** (Tracks 1/2) | thumbnail filmstrip (no solid fill) | thin hairline frame |
| **Audio — green** (Tracks 1/3) | `#0C2A26` | waveform `#248F6C` |
| **Audio — blue** (Track 2) | `#162245` | waveform `#4370B2` |

- Clip corners ~4px, white labels top-left, left accent edge. Lighter same-hue border = selected.

---

## Token change map (current → target)

Current values from `packages/editor/src/styles/tokens.css`. Apply the same shifts in
`globals.css`. **`[confirm]`** = not directly evidenced by the timeline node; needs your call.

### Surfaces (warm-charcoal → cool-navy)
| Token | Current | Target |
|-------|---------|--------|
| `--elah-bg` | `#0a0909` | `#0a0c10` |
| `--elah-bg-secondary` | `#0d0c0c` | `#101217` |
| `--elah-bg-panel` | `#181616` | `#0e1319` |
| `--elah-bg-card` | `#201d1d` | `#15191f` |
| `--elah-bg-elevated` | `#282424` | `#1b2028` |
| `--elah-bg-highest` | `#312d2d` | `#232a33` |

### Borders / text
| Token | Current | Target |
|-------|---------|--------|
| `--elah-border` | `#302828` | `#283040` |
| `--elah-border-subtle` | `#231f1f` | `#1b212c` |
| `--elah-outline` | `#564848` | `#3a4150` |
| `--elah-text` | `#f0ecea` | `#e9edf3` |
| `--elah-text-muted` | `#9e918f` | `#8a909c` |

### Timeline / playhead
| Token | Current | Target |
|-------|---------|--------|
| `--elah-playhead` | `#ff2d55` | `#ffffff` |
| `--elah-tick-color` | `#302828` | `#394146` |
| `--elah-tick-label` | `#9e918f` | `#7a858b` |
| `--elah-selection-border` | `#ff2d55` | **keep `#ff2d55`** (decision: ring stays crimson vs white playhead) |
| `--elah-selection-glow` | `rgba(255,45,85,.4)` | **keep** |

### Accent — DECISION: keep crimson app-wide
`--elah-accent*` tokens are **unchanged**. The blue is applied **only** to the timeline zoom
slider thumb via a local class/token (`--elah-zoom-thumb: #3b82f6`), not the global accent.

### Clip — text (purple → orange)
| Token | Current | Target |
|-------|---------|--------|
| `--elah-clip-text-top` | `#a855f7` | `#ad5621` |
| `--elah-clip-text-mid` | `#9333ea` | `#8f3f18` |
| `--elah-clip-text-bottom` | `#7e22ce` | `#7a2e10` |
| `--elah-clip-text-accent` | `#c084fc` | `#c9763f` |
| `--elah-tag-text-fg` | `#c4b5fd` | `#f0b483` |
| `--elah-tag-text-bg` | `rgba(147,51,234,.25)` | `rgba(173,86,33,.25)` |
| `--elah-tag-text-border` | `rgba(147,51,234,.4)` | `rgba(173,86,33,.4)` |

### Clip — audio (green at rest; blue = selected/active state)
| Token | Current | Target |
|-------|---------|--------|
| `--elah-clip-audio-top` | `#22c55e` | `#2f9e74` |
| `--elah-clip-audio-mid` | `#16a34a` | `#1f7d5c` |
| `--elah-clip-audio-bottom` | `#15803d` | `#0c2a26` |
| `--elah-clip-audio-accent` | `#4ade80` | `#34d39e` |
| `--elah-clip-audio-sel-top` _(new)_ | — | `#4370b2` |
| `--elah-clip-audio-sel-bottom` _(new)_ | — | `#162245` |

> **Decision:** blue audio clip = **selected/active state**. Resting audio is teal-green; the
> selected audio clip tints blue (`#162245`→`#4370b2`). The crimson selection ring still applies
> on top (per selection-ring decision). Needs a small `ClipBlock` change to swap the audio body
> ramp when selected.

### Clip — video / effect (indigo effect clip)
| Token | Current | Target |
|-------|---------|--------|
| `--elah-clip-video-*` | blue `#3b82f6`→`#1d4ed8` | keep blue (media clips show thumbnails); align top to `#3b82f6` |
| `--elah-transition-fill` | `#6b8cff` | `#3c3e94` `[confirm]` (matches "Chrom…room" effect clip) |
| `--elah-transition-stroke` | `#a5b4fc` | `#525480` `[confirm]` |

## Needs a rendering change, not just a token (flag)

1. **Audio waveform color.** Figma draws a **tinted waveform on a dark clip body** (green
   `#248F6C` on `#0C2A26`; blue `#4370B2` on `#162245`). Current code paints a **white waveform
   on a colored gradient** (`--elah-effect-waveform: rgba(255,255,255,.85)`). Matching Figma means
   changing how `ClipBlock`/the audio renderer tints the waveform per clip, not just a token swap.
2. **Blue audio clip.** Figma shows one audio track in blue and two in green. Is blue a **distinct
   audio category**, a **selected/active state**, or a **per-clip user color**? Code currently has a
   single audio ramp. → open question 2 below.

## Decisions (resolved 2026-06-26)

1. **Accent:** keep crimson app-wide. Blue only on timeline zoom thumb (local).
2. **Blue audio clip:** selected/active state (green at rest → blue when selected).
3. **Selection ring:** keep crimson `#ff2d55` (playhead goes white).
4. **Indigo "Chrom…room" clip:** _still open_ — treat as the existing effect/transition clip
   styling for now (`--elah-transition-*`); revisit if it's a distinct type.

## Implementation order (when greenlit)

1. Retint surfaces + borders + text (cool-navy) in both token files.
2. Playhead → white; tick/label → cool gray; selection ring → its own color (Q3).
3. Text clip + text tag → orange.
4. Audio clip ramp → teal-green; decide waveform tint rendering (flag 1).
5. Accent → blue (Q1) — gated on confirmation since it's app-wide.
6. Visual check against `docs/assets/timeline-redesign/timeline.png`.
