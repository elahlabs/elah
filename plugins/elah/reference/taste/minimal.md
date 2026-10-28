# Look: Clean Sheet (`minimal`)

Read `floor.md` too. Clarity first: software, finance, B2B, one number, a considered announcement, an explainer that must be easy to
follow. Flat, sparse, mostly empty. Numbers are starting values; adapt them to the clip. The motion block and components below are
the VideoSpec's; for a programmatic video read the taste as tokens, curves and recipes in `programmatic/motion.md` and
`programmatic/recipes.md`.

## Palette (all six tokens) and fonts

`clean-green` (ink on paper, one green accent); `arctic-steel` for blue brands; `ocean-depths` when it must be dark. From `themes.md`:

| bg | ink | muted | accent | accentSoft | surface |
| --- | --- | --- | --- | --- | --- |
| #f7f7f5 | #111111 | #6b6b6b | #15803d | #bbf7d0 | #ffffff |

Fonts: `sans: inter` carries everything (headline weight 700, support 400). `serif: playfair-display` only for one italic emphasis
word in the whole piece. Never a third face.

## Motion block

`"motion": { "energy": "standard", "camera": false, "ambient": "none", "transition": "crossfade" }`: no camera move, no ambient layer,
the flat ground is the texture. The smallest move that reads: arrivals of 0.3-0.4 s travelling 30-60 px (`slide-in-up`), text by
reveal `word-fade`, one element moving at a time 0.2 s apart, exits `fade-out` 0.2 s. Between beats a hard cut or a short crossfade
(`cut` is a legitimate `transition` here). A long hold may float: polish adds the 6 px float anyway.

## Type, colour and layout

- Three sizes at most, each at least 1.6x the next: headline (bold) 96-140 px at 1080 wide (172-248 landscape), support 48-64
  (86-114), one caption 30-38 (54-68). Headline `letterSpacing` -1 to -2.
- Two values only: ink on paper and `$muted` for secondary lines. The accent on one word, one rule or one dot per beat, under 5% of
  the frame. No gradient, no tint behind text, no shadow, no glow.
- 60-70% of the frame stays empty. One column on a left margin of 8%; the hero on the upper-third line (y about 0.33-0.4), the
  support one size down and 24-40 px below it, every element on the same left edge. Five or six parts a beat: hero, support, label,
  a 2 px rule, one dot. No cards, no borders around text; at most 8 words in one beat.

## Components and presets

`big-number` (one figure), `stat-ring`, `kinetic-title` (the serif italic emphasis word is the one allowed serif), `checklist` for
steps (expect its known notes from `components.md`), `logo-outro`. Raw: `slide-in-up`, `fade-in`, reveal `word-fade`, exit `fade-out`.

## Avoid

Gradients, glow, shadows. A second accent. An icon on every line. Centred layouts. Text under 30 px at 1080 wide. More than 8 words
in one beat. Bouncy springs.

```json
{
  "format": "elah-input", "version": 1, "title": "Minimal statement",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Minimal statement", "format": { "width": 1080, "height": 1080, "fps": 30 }, "duration": 4,
    "background": "$bg", "motion": { "energy": "standard", "camera": false, "ambient": "none", "transition": "crossfade" },
    "design": {
      "colors": [ { "name": "bg", "value": "#f7f7f5" }, { "name": "ink", "value": "#111111" }, { "name": "muted", "value": "#6b6b6b" },
        { "name": "accent", "value": "#15803d" }, { "name": "accentSoft", "value": "#bbf7d0" }, { "name": "surface", "value": "#ffffff" } ],
      "fonts": [ { "role": "sans", "font": "inter" } ]
    },
    "elements": [
      { "id": "rule", "kind": "shape", "shape": "line", "at": 0, "duration": 4, "w": 200, "h": 2, "stroke": "$ink", "strokeWidth": 2, "x": 0.1726, "y": 0.26,
        "draw": { "duration": 0.6, "curve": "cubic-out" }, "enter": "fade-in" },
      { "id": "hero", "kind": "text", "at": 0.2, "duration": 3.8, "text": "Fewer, better.", "font": "$sans", "weight": 700, "size": 130, "color": "$ink",
        "align": "left", "maxWidth": 800, "x": 0.45, "y": 0.38, "letterSpacing": -2, "reveal": { "preset": "word-fade", "stagger": 0.12, "duration": 0.4 } },
      { "id": "support", "kind": "text", "at": 0.7, "duration": 3.3, "text": "Built for people who ship.", "font": "$sans", "size": 56, "color": "$muted",
        "align": "left", "maxWidth": 800, "x": 0.45, "y": 0.52, "enter": "slide-in-up" },
      { "id": "dot", "kind": "shape", "shape": "circle", "at": 1.2, "duration": 2.8, "w": 22, "h": 22, "fill": "$accent", "x": 0.091, "y": 0.66, "enter": "pop-in" }
    ]
  } }
}
```
