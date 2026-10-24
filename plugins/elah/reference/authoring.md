# Writing an Elah video: cheat sheet

Source of truth is the engine. Names (fonts, icons, motion presets, components, curves, generators, effects) come from
`node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --vocabulary`. Run it once per video and use only names it prints; do not
invent names. The validator rejects unknown names with the path of the bad field.

## The input file: `elah-input.json`

```json
{
  "format": "elah-input",
  "version": 1,
  "title": "Launch promo",
  "source": { "kind": "spec", "spec": { } }
}
```

`source` is exactly one of:

- `{ "kind": "spec", "spec": <VideoSpec> }` (default)
- `{ "kind": "html", "html": "<section id=…>", "css": "…", "durationSeconds": 20, "stage": { "width": 1920, "height": 1080 }, "fps": 30 }`
- `{ "kind": "project", "project": <.elah.json Project document> }` (only when the user hands you one)

## VideoSpec (the default)

```json
{
  "version": 1,
  "title": "Launch card",
  "format": { "width": 1080, "height": 1920, "fps": 30 },
  "duration": 4,
  "background": "$bg",
  "design": {
    "colors": [ { "name": "bg", "value": "#0b1020" }, { "name": "ink", "value": "#ffffff" }, { "name": "accent", "value": "#ffd166" } ],
    "fonts": [ { "role": "sans", "font": "inter" }, { "role": "display", "font": "bebas-neue" } ]
  },
  "elements": [
    { "id": "ring", "kind": "shape", "shape": "arc", "at": 0.2, "duration": 3.6, "w": 420, "h": 420,
      "stroke": "$accent", "strokeWidth": 18, "cap": "round", "x": 0.5, "y": 0.4, "draw": { "duration": 1.2, "curve": "cubic-out" } },
    { "id": "big", "kind": "text", "at": 0.4, "duration": 3.4, "text": "72%", "font": "$display", "size": 220,
      "color": "$ink", "x": 0.5, "y": 0.4, "enter": "pop-in", "exit": "fade-out" },
    { "id": "label", "kind": "text", "at": 0.8, "duration": 3, "text": "of attacks start on free Wi-Fi", "font": "$sans",
      "size": 48, "color": "$ink", "maxWidth": 800, "x": 0.5, "y": 0.62,
      "reveal": { "preset": "word-rise", "stagger": 0.08, "duration": 0.4 } }
  ]
}
```

Rules:

- Times are seconds. `at` is the start, `duration` the length. Positions `x`/`y` are fractions of the stage (0.5, 0.5 is the
  centre); sizes (`w`, `h`, `size`, `strokeWidth`) are stage pixels.
- `kind` is `text | shape | icon | image | audio | generator | group` (and `component` / `system` for the richer motion
  vocabulary; see the `--vocabulary` output). `shape` is `rect | circle | ellipse | triangle | polygon | line | path | arc`.
- Colours and fonts are tokens declared in `design` and referenced as `"$ink"`, `"$sans"`, or a raw hex / bundled font id.
  Components colour themselves from the tokens `bg`, `ink`, `muted`, `accent`, `accentSoft` (glows, markers, highlighted
  circles) and `surface` (cards, icon discs). Declare all six; a missing one falls back to a default (accentSoft is a pale
  green) that will clash with your palette.
  Only the bundled fonts exist (the vocabulary lists them). Icons are Lucide names from the vocabulary only.
- `enter`, `exit`, `reveal`, `draw` take preset names from the vocabulary. `layer` orders overlapping elements. A `group`
  holds `children` whose `at` is relative to the group.
- `image` and `audio` need a source the viewer's browser can load (an https URL or a data URL). Do not reference local files
  or invent URLs. If the user has no media, build the piece from text, shapes, icons and generators.
- Layout: a stage is `{ "width": 1920, "height": 1080 }` (landscape), `{ 1080, 1920 }` (vertical) or `{ 1080, 1080 }`. 30 fps.
  Keep text inside the safe area (about 8% margins), keep two or more things on screen at any moment, and vary the entrances.
- Warnings from the validator (`hard-cut`, `off-scale-type`, …) are advice; errors must be fixed.

## HTML/CSS scene (only when layout is easier as CSS)

A fragment plus one stylesheet, in a whitelisted subset. The validator refuses anything outside it and names the substitute.

- Tags: `div section header footer p h1-h6 span ul ol li svg img`. No `script canvas iframe video button a table br`.
- Layout: `position` static/relative/absolute, `display` block/flex/grid/inline-block/none, flex and grid properties, px sizes.
- Look: colours, gradients, one outer `box-shadow`, `border-radius`, `opacity`, `mix-blend-mode`, `clip-path`, `filter: blur()|drop-shadow()`,
  `text-shadow`, `-webkit-text-stroke`, gradient text.
- Refused: `transform` (use `translate`, `rotate`, `scale`), `animation`, `transition`, `@keyframes`, `@font-face`, `@import`, `url()`,
  `backdrop-filter`, `text-transform`, `perspective`, pseudo-classes. Selectors: `:root`, `#id`, `.class` only.
- Fonts: one bundled family per element (`font-family: inter`).
- Motion: a `data-motion` attribute, clauses separated by `;`, for example
  `in: pop-overshoot 0.4s @0.2; x: 0.30 → 0.50 0.6s overshoot @1.0; out: blur-out 0.3s @-0.3`.
- The validator here only checks the subset. Layout and motion clauses are measured and converted inside the artifact, which
  shows any conversion problem in a panel. Ask the user to paste that panel back if it reports one.
