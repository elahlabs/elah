# Taste: brutalist

Read `floor.md` too. Raw and structural: sport, streetwear, a manifesto, a data story with attitude, gaming, a loud announcement.
Rigid grid, extreme type contrast, mono labels, hard cuts. Numbers are starting values; adapt them to the clip.

## Palette (all six tokens) and fonts

`neon-lime`. From `themes.md`:

| bg | ink | muted | accent | accentSoft | surface |
| --- | --- | --- | --- | --- | --- |
| #0a0a0a | #f2f2ee | #8c8c85 | #c6f432 | #3a4a0c | #161616 |

Fonts: `display: anton` (or `bebas-neue`) in capitals for the hero, `mono: roboto-mono` for labels and support. Two faces, no italics.
Type the capitals yourself; do not rely on a case style. Never a second accent.

## Motion block

`"motion": { "energy": "bold", "camera": false, "ambient": "grid", "transition": "cut" }`. Mechanical, nothing soft: arrivals of
0.25-0.33 s on `spring:stiff` or `expo-out`, exits `wipe-out` of 0.2 s, rules draw on. Beats are hard cuts; one `section-break`
or `wipe` hand-off at most once per 4 s. Hold the hit for 1 s, then cut. Energy `bold` is x0.75 on every time.

## Type, colour and layout

- Hero: anton caps at the top of the band, 96-140 px vertical (172-248 landscape), `letterSpacing` -2 to -4, line height 0.9-1.0.
  Contrast does the shouting: the support line is at most 40% of the hero (mono 48-64 vertical) and labels sit in the caption
  band written as catalogue codes (`01 / 04`). The lint caps size, so make a number bigger with `big-number` or a `counter`.
- Colour: near-black ground, off-white ink. The accent on the one number or word that matters, under 10% of the frame; one solid
  accent block (a `rect`) in the whole piece, on the last beat.
- A rigid grid: 6-8% margins, every element snapped to a column edge, the hero hard against one edge, 2 px rules cutting the frame
  into cells, a label in a cell corner. Squares and rectangles only (`radius` 0). Ambient `grid` supplies faint lines.

## Components and presets

`word-hits` (the signature: 3-8 words, add two raw parts so the beat is not sparse), `big-number`, `section-break`, `comparison`,
`stat-bars`. Raw: enter `wipe-in`, `tracking-in`, `punch-in`, `impact`; exit `wipe-out`; reveal `char-pop` or `word-pop` on a short
label; an `rgbSplit` or `chromaticAberration` effect on the hit frame only.

## Avoid

Soft gradients, pastels, rounded corners. Centred headlines. Sentence case on the hero. Slow settling eases. Decorative icons: the
grid and the type are the decoration. Glow and blur.

```json
{
  "format": "elah-input", "version": 1, "title": "Brutalist hit",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Brutalist hit", "format": { "width": 1080, "height": 1920, "fps": 30 }, "duration": 3,
    "background": "$bg", "motion": { "energy": "bold", "camera": false, "ambient": "grid", "transition": "cut" },
    "design": {
      "colors": [ { "name": "bg", "value": "#0a0a0a" }, { "name": "ink", "value": "#f2f2ee" }, { "name": "muted", "value": "#8c8c85" },
        { "name": "accent", "value": "#c6f432" }, { "name": "accentSoft", "value": "#3a4a0c" }, { "name": "surface", "value": "#161616" } ],
      "fonts": [ { "role": "display", "font": "anton" }, { "role": "mono", "font": "roboto-mono" } ]
    },
    "elements": [
      { "id": "label", "kind": "text", "at": 0, "duration": 3, "text": "01 / 04", "font": "$mono", "weight": 700, "size": 34, "color": "$muted",
        "align": "left", "maxWidth": 400, "x": 0.287, "y": 0.2, "letterSpacing": 4, "enter": "tracking-in" },
      { "id": "hero", "kind": "text", "at": 0.1, "duration": 2.9, "text": "LOUDER", "font": "$display", "size": 140, "color": "$ink",
        "align": "left", "maxWidth": 860, "x": 0.5, "y": 0.42, "letterSpacing": -3, "enter": "wipe-in", "exit": "wipe-out" },
      { "id": "bar", "kind": "shape", "shape": "line", "at": 0.3, "duration": 2.7, "w": 860, "h": 4, "stroke": "$accent", "strokeWidth": 4, "x": 0.5, "y": 0.56,
        "draw": { "duration": 0.5, "curve": "expo-out" }, "enter": "fade-in" },
      { "id": "sub", "kind": "text", "at": 0.5, "duration": 2.5, "text": "THAN LAST YEAR", "font": "$mono", "weight": 700, "size": 52, "color": "$ink",
        "align": "left", "maxWidth": 860, "x": 0.5, "y": 0.63, "enter": "slide-in-left" }
    ]
  } }
}
```
