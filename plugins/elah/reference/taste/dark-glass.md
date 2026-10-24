# Taste: dark glass

Read `floor.md` too. Quiet, high-end tech: AI, hardware, fintech, developer tools, a product reveal, a logo sting. Near-black ground,
one soft glow, hairline rules, wide light sans. Numbers are starting values; adapt them to the clip.

## Palette (all six tokens) and fonts

`midnight-teal` (or `graphite-violet` for a violet brand; `ocean-depths` for cooler). From `themes.md`:

| bg | ink | muted | accent | accentSoft | surface |
| --- | --- | --- | --- | --- | --- |
| #0b0f14 | #f4f6f8 | #8a94a3 | #5eead4 | #134e4a | #151b24 |

Fonts: `sans: inter` for the headline at weight 400 (never a condensed face), `display: space-grotesk` for numbers and labels. Two faces.

## Motion block

`"motion": { "energy": "calm", "camera": true, "ambient": "orbs", "transition": "crossfade" }` (`gradient` ambient for a flatter look).
Calm energy means 1.3x longer arrivals on `spring:gentle`; hand-offs are crossfades, `zoom` for one reveal at most. No shake, no glitch.

## Type, colour and layout

- Headline: inter 400, 172-248 px landscape or 96-140 vertical, `letterSpacing` +2 to +4, sentence case, left-aligned on one margin
  (a logo sting may centre). Labels: 54-68 landscape (30-38 vertical) in caps, `letterSpacing` +6, `$muted`.
- Colour: near-black ground, ink text. One soft glow behind or on the hero (`glow` effect, `intensity` 0.8-1.5, `radius` 40-80), under
  15% of the frame. Add `bloom` (`threshold` 0.7) only on the one hero.
- Glass: a `rect` with `radius` 24-32, `fill: "$surface"`, `opacity` 0.6-0.8, plus a 1 px `stroke: "$muted"` hairline. One panel per beat,
  40-50% of the frame wide, padding 48 px; the hero sits in the panel or beside it, never both. Two or three hairline rules. Keep
  40% of the frame empty.

## Components and presets

`kinetic-title` (emphasis word in accent), `big-number`, `stat-ring`, `icon-row`, `badge-callouts` (variant `circle`), `logo-outro`.
Raw text: `blur-in` for headlines, `tracking-in` for labels, `slide-in-up` (30-60 px) for panels, reveal `word-fade` or `line-rise`.
Curves `spring:gentle` and `ease-in-out`; exits `fade-out`. A background layer drifting at a third of the panel speed is the ambient `orbs`.

## Avoid

Fully saturated neon. A second glow colour. Glass panels stacked three deep. Bold condensed headlines. Sharp corners. Text under
54 px landscape (30 vertical) on a glass fill. Glow on everything: it is one hero's light.

```json
{
  "format": "elah-input", "version": 1, "title": "Dark glass reveal",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Dark glass reveal", "format": { "width": 1920, "height": 1080, "fps": 30 }, "duration": 5,
    "background": "$bg", "motion": { "energy": "calm", "camera": true, "ambient": "orbs", "transition": "crossfade" },
    "design": {
      "colors": [ { "name": "bg", "value": "#0b0f14" }, { "name": "ink", "value": "#f4f6f8" }, { "name": "muted", "value": "#8a94a3" },
        { "name": "accent", "value": "#5eead4" }, { "name": "accentSoft", "value": "#134e4a" }, { "name": "surface", "value": "#151b24" } ],
      "fonts": [ { "role": "sans", "font": "inter" }, { "role": "display", "font": "space-grotesk" } ]
    },
    "elements": [
      { "id": "panel", "kind": "shape", "shape": "rect", "at": 0, "duration": 5, "w": 1000, "h": 560, "radius": 28, "fill": "$surface", "opacity": 0.7,
        "stroke": "$muted", "strokeWidth": 1, "x": 0.36, "y": 0.5, "enter": "slide-in-up" },
      { "id": "label", "kind": "text", "at": 0.5, "duration": 4.5, "text": "ORBIT 2 / PREVIEW", "font": "$display", "size": 54, "color": "$muted",
        "align": "left", "maxWidth": 760, "x": 0.3225, "y": 0.34, "letterSpacing": 6, "enter": "tracking-in" },
      { "id": "hero", "kind": "text", "at": 0.7, "duration": 4.3, "text": "Orbit 2", "font": "$sans", "weight": 400, "size": 200, "color": "$ink",
        "align": "left", "maxWidth": 760, "x": 0.3225, "y": 0.5, "letterSpacing": 3, "enter": "blur-in",
        "effects": [ { "kind": "glow", "params": [ { "name": "intensity", "value": 1 }, { "name": "radius", "value": 60 } ] } ] },
      { "id": "sub", "kind": "text", "at": 1.1, "duration": 3.9, "text": "Quiet power, all day.", "font": "$sans", "size": 86, "color": "$ink",
        "align": "left", "maxWidth": 760, "x": 0.3225, "y": 0.68, "reveal": { "preset": "word-fade", "stagger": 0.1, "duration": 0.4 } },
      { "id": "dot", "kind": "shape", "shape": "circle", "at": 1.4, "duration": 3.6, "w": 24, "h": 24, "fill": "$accent", "x": 0.58, "y": 0.34, "enter": "pop-in" }
    ]
  } }
}
```
