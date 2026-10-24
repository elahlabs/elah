# Writing an Elah video: file format cheat sheet

This file is the format only. The craft (what to make, how it should move) starts at `director.md`.

Source of truth is the engine. Names (fonts, icons, motion presets, components, systems, curves, generators, effects) come from
`node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --vocabulary`. Run it once per video and use only names it prints; do not
invent names. The validator rejects unknown names with the path of the bad field.

## The input file: `elah-input.json`

```jsonc
{ "format": "elah-input", "version": 1, "title": "Launch promo", "source": { "kind": "spec", "spec": { /* VideoSpec */ } } }
```

`source` is exactly one of:

- `{ "kind": "spec", "spec": <VideoSpec> }` (default)
- `{ "kind": "html", "html": "<section id=…>", "css": "…", "durationSeconds": 20, "stage": { "width": 1920, "height": 1080 }, "fps": 30 }`
- `{ "kind": "project", "project": <.elah.json Project document> }` (only when the user hands you one)

## VideoSpec (the default)

```json
{
  "format": "elah-input",
  "version": 1,
  "title": "Launch card",
  "source": {
    "kind": "spec",
    "spec": {
      "version": 1,
      "title": "Launch card",
      "format": { "width": 1080, "height": 1920, "fps": 30 },
      "duration": 5,
      "background": "$bg",
      "motion": { "energy": "standard", "camera": false, "ambient": "none", "transition": "cut" },
      "design": {
        "colors": [
          { "name": "bg", "value": "#0b1020" }, { "name": "ink", "value": "#ffffff" }, { "name": "muted", "value": "#94a3b8" },
          { "name": "accent", "value": "#ffd166" }, { "name": "accentSoft", "value": "#4a3b12" }, { "name": "surface", "value": "#141b30" }
        ],
        "fonts": [ { "role": "sans", "font": "inter" } ]
      },
      "elements": [
        { "id": "ring", "kind": "shape", "shape": "arc", "at": 0, "duration": 5, "w": 420, "h": 420,
          "stroke": "$accent", "strokeWidth": 18, "cap": "round", "x": 0.5, "y": 0.4, "draw": { "duration": 1.2, "curve": "cubic-out" }, "enter": "fade-in" },
        { "id": "bolt", "kind": "icon", "icon": "zap", "at": 0.2, "duration": 4.8, "w": 120, "h": 120, "color": "$accent", "x": 0.5, "y": 0.2,
          "keys": [ { "channel": "x", "at": 0, "value": 0.3 }, { "channel": "x", "at": 0.7, "value": 0.5, "curve": "cubic-out" },
            { "channel": "scale", "at": 0, "value": 0.4 }, { "channel": "scale", "at": 0.6, "value": 1, "curve": "spring:bouncy" },
            { "channel": "opacity", "at": 0, "value": 0 }, { "channel": "opacity", "at": 0.3, "value": 1, "curve": "cubic-out" } ] },
        { "id": "big", "kind": "generator", "generator": "counter", "at": 0.4, "duration": 4.6, "w": 400, "h": 200, "x": 0.5, "y": 0.4, "enter": "fade-in",
          "params": [ { "name": "to", "value": 72 }, { "name": "suffix", "value": "%" }, { "name": "countFraction", "value": 0.35 },
            { "name": "fontSize", "value": 150 }, { "name": "color", "value": "#ffffff" } ] },
        { "id": "label", "kind": "text", "at": 0.8, "duration": 4.2, "text": "of attacks start on free Wi-Fi", "font": "$sans",
          "size": 56, "color": "$ink", "maxWidth": 800, "x": 0.5, "y": 0.62,
          "reveal": { "preset": "word-rise", "stagger": 0.08, "duration": 0.4 },
          "expressions": [ { "channel": "y", "source": "value + sin(t * 2 * PI / 3.2) * 0.004" } ] }
      ]
    }
  }
}
```

The example uses the four parts you will reach for after text and shapes:

- `icon`: `icon` is a vocabulary name, `color` a token, `w`/`h` px. `keys` are `{ channel, at, value, curve }`: `at` is seconds from
  the element's own start, `x`/`y` values are stage fractions, `scale`/`opacity` are multipliers, and `curve` describes the segment
  arriving at that key (the first key's curve is unused). Channels: x y scale scaleX scaleY rotation opacity volume cornerRadius draw.
- `generator` (data: `counter`, `barChart`, `progressBar`; looks: `particles`, `lightLeak`, ... all in `--vocabulary`): options are
  `params` rows `{ name, value }`; fill timing and colour rules for the data ones are in `craft/generators.md`.
- `expressions`: `{ channel, source }` on any channel but `draw`; `value` is the keyed value, `t` seconds on the element's clock, and
  `sin`, `cos`, `PI` exist. The one above is a 0.4% float; for constant spin use `value + t * 0.5 * PI` on `rotation`.

Rules:

- Times are seconds. `at` is the start, `duration` the length. Positions `x`/`y` are fractions of the stage (0.5, 0.5 is the
  centre; for text it is the centre of the text box); sizes (`w`, `h`, `size`, `strokeWidth`) are stage pixels.
- `kind` is `text | shape | icon | image | audio | generator | group | component | system | vector` (the `KINDS` line of
  `--vocabulary` lists all ten; `component` and `system` are in `components.md`). `shape` is `rect | circle | ellipse | triangle | polygon | line | path | arc`.
- Colours and fonts are tokens declared in `design` and referenced as `"$ink"`, `"$sans"`, or a raw hex / bundled font id.
  Components colour themselves from six tokens: `bg`, `ink`, `muted`, `accent`, `accentSoft` (glows, markers, highlighted
  circles) and `surface` (cards, icon discs). Declare all six; a missing one falls back to a default (accentSoft is a pale
  green) that will clash with your palette. Only the bundled fonts exist. Icons are Lucide names from the vocabulary only.
- `enter`, `exit`, `reveal`, `draw` take preset names from the vocabulary. `layer` orders overlapping elements (higher is in front).
  A `group` holds `children` whose `at` is relative to the group.
- `motion` (root, all optional): `{ "energy": "calm|standard|bold", "camera": true|false, "ambient": "none|orbs|grid|dots|grain|gradient",
  "transition": "cut|crossfade|wipe|zoom|slide|mask" }`. Defaults: standard, camera on, orbs, wipe.
- **Polish runs automatically** after you write the spec, and only fills gaps you left: arrival and exit keys on elements without
  one, a 0.07 s stagger between siblings that share an `at` (never tie top-level `at`s: `craft/motion.md`, Compile length), a 4% camera push on each top-level group, an idle float on anything that
  holds still over 1.2 s, the ambient layer, and the `motion.transition` hand-off where one top-level beat ends exactly when the next
  starts. It never overrides a choice you made. Do not hand-write what it already adds; set `motion` instead.
- `image` and `audio` need a source the viewer's browser can load (an https URL or a data URL). Do not reference local files
  or invent URLs. If the user has no media, build the piece from text, shapes, icons and generators.
- Layout: a stage is `{ "width": 1920, "height": 1080 }` (landscape), `{ 1080, 1920 }` (vertical) or `{ 1080, 1080 }`. 30 fps.
  Text boxes keep 6% side margins (the lint line; aim for 8%). Left-aligned text: `align: "left"`, a `maxWidth`, and
  `x = margin + maxWidth / 2 / stageWidth`, because `x` is the centre of the box. Type sizes sit in the bands of `craft/type-and-layout.md`.
- Validator output: `node validate.mjs <file>` prints errors (fix every one) and warnings (`hard-cut`, `off-scale-type`, …; fix them or
  say why you keep them, see `craft/review.md`). `--notes` also prints what polish added; `--json` prints everything as JSON.

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
