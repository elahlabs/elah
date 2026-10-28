# Components and systems: what to reach for

A component is a named piece of motion design (stagger, spring arrival, idle float, exit, hand-off already done). Build every beat
from one when one fits; use raw elements for decoration and one-offs. Fields: `id`, `kind: "component"`, `component`, `at`,
`duration`, plus `text`, `sub`, `emphasis` (words in `text`), `items` (`{ text, sub, icon, value, style }`), `variant`, `energy`,
and for some components `x`, `y`, `w`, `h` (see Regions: most components ignore them). Lengths below are the engine's accepted
range in seconds; outside it the value is clamped with a warning.

| Component | Seconds | Use it for | Content |
| --- | --- | --- | --- |
| `kinetic-title` | 2.2-6 | the opening or any message beat | `text`, `emphasis: ["word"]`, optional `sub` kicker |
| `word-hits` | 1.2-12 | impact: 3-8 single words punching in | `items` of 1-8 words, at least 0.7 s per word; style `serif` or `accent` breaks the alternation |
| `typewriter-line` | 1.4-5 | one sharp statement typed with a caret | `text`, optional `sub` as a faint ghost word |
| `circled-phrase` | 1.8-5 | calling out one phrase | `text`, `variant` circle / underline / marker; skip `sub` (its 36 px lead-in is off the landscape bands) |
| `quote-card` | 2.5-7 | a testimonial or one line worth framing | `text`, `sub` attribution |
| `clock-sweep` | 2.2-6 | time, speed, deadlines | `text` caption |
| `logo-outro` | 1.8-5 | the closing beat; holds, no exit | `text` wordmark; leave `sub` empty (tagline below) |
| `section-break` | 0.5-1.2 | a wipe between acts carrying one word | `text` |
| `stat-ring` | 2.5-5 | one percentage | one item: `value` 0-100, `text` caption; variant percent / full |
| `stat-bars` | 3-6 | a comparison of 2-6 values | items `text` label, `value` height, style `highlight` for the one that matters |
| `big-number` | 2-4 | one headline metric | one item: `value`, `text` label; variant below / beside |
| `icon-row` | 2.5-5 | 3-7 capabilities as icons | items `icon` (vocabulary name), style `highlight` on one |
| `badge-callouts` | 3-6 | 2-4 features or credentials with labels | items `icon`, `text`; variant hexagon / circle |
| `chip-cloud` | 3-6 | 3-8 tags or keywords | items `text`, style `filled` or `outline` |
| `checklist` | 3-6 | 2-6 steps checked off, last one emphasised | items `text` |
| `testimonial-cards` | 3.5-7 | social proof (only quotes the user supplied) | 2-3 items: `text` quote, `sub` name, `value` 1-5 stars |
| `comparison` | 3-6 | before/after, us/them | 2-8 items, style `muted` (left) or `accent` (right) alternating |

Placement: a component is normally one top-level beat of its own. It may also be a child of a raw beat `group` next to raw parts
(validated: a `big-number` plus a top-band label in one group compiles clean); then its `at` is relative to the group, the group's
fade and camera push wrap it, the Regions rule below still holds in stage fractions, and in the editor it opens as a compound inside
the group's compound. The parts it makes have ids prefixed with its own `id`, and `sfx.on.element`
must name a part, not the component: `<id>-wordmark` (logo-outro), `<id>-word-0` (kinetic-title), `<id>-counter` (big-number,
stat-ring), `<id>-phrase` (circled-phrase), `<id>-panel` (section-break), `<id>-line` (typewriter-line). Naming the component itself
drops the cue (`sfx-no-event`).

## Regions: a component owns its box

A component lays itself out in its own region (default: the central band, x 0.08-0.92, y 0.25-0.75 of the stage). A raw element in
the same beat that enters that region collides with it: a raw line over a `circled-phrase` lead-in is the known failure. Rule: **raw
parts in a component's beat stay outside its box**, or the beat is the component alone. Only some components move:

- Honour `x`, `y` (the centre): `big-number` (`x` is clamped to 0.38-0.62), `stat-ring` (also `w`/`h`, diameter = the smaller), `icon-row`, `chip-cloud`,
  `badge-callouts`, `testimonial-cards`, `checklist` (also `w`, the row width), `stat-bars` (`y` is the baseline), `comparison`
  (`y` is the top). Box = `x ± w/2/W`, `y ± h/2/H` with `w x h` in px, the same on every stage: `big-number` 710 x 360
  (y 0.44), `stat-ring` 670 x 590 (0.40), `stat-bars` 545 x 460 (rises 0.38 above the baseline 0.56), `icon-row` 650 x 160 (0.46),
  `chip-cloud` 680 x 680 (0.46), `checklist` `w` x 310 (default `w` is 0.72 W). `badge-callouts`, `testimonial-cards` and `comparison`
  are 1000-1500 px wide: they take the frame, do not share it.
- Ignore `x`, `y`, `w`, `h` (fixed place, y band as a fraction of height, landscape | vertical, centred): `kinetic-title`
  0.27-0.61 | 0.32-0.58; `word-hits` 0.31-0.61 | 0.37-0.54; `typewriter-line` 0.36-0.60 | 0.41-0.55 (x 0.08-0.66 landscape; a 220 px
  ghost word sits behind it); `circled-phrase` 0.33-0.57 | 0.34-0.54, width 60 px x letters + 52 (lead-in y 0.36, phrase y 0.48, loop
  176 px tall; the four burst dots are decoration); `quote-card` 0.21-0.71 | 0.26-0.71; `clock-sweep` 0.16-0.75 | 0.27-0.60;
  `logo-outro` 0.36-0.56 plus its ring.

Sharing a beat with a mover: put it in the right 45% (landscape `x: 0.72` puts `stat-ring` at x 0.55-0.90), build the raw side as
left-aligned text with `x = 0.08 + maxWidth/2/W` and a right edge at least 0.03 left of the box (here maxWidth up to 830). With a fixed component: raw parts
only in the top band (y <= 0.20: label, rule, `01 / 04` tag) or the bottom band (y >= 0.80: caption, source line). A raw text box is
`x ± maxWidth/2/W`, `y ± size x 1.15/2/H`; it must not overlap the box.

## logo-outro tagline: author it yourself

The component's own `sub` tagline is 40 px, `muted`, at y 0.52: it lands on the accent ring and reads small and faint. Leave `sub`
empty and write the tagline as a raw text element in the same beat (a sibling, array-ordered after the beat, never tied to another
`at`): `$ink`, weight 400, size 68 landscape / 38 at 1080 wide, centred. The ring is 0.9 x the wordmark width (`W_mark = max(120,
58 px x letters)` at 104 px) and grows to 1.5x while it fades, so its radius reaches `0.675 x W_mark` px:
**tagline y = 0.46 + 0.675 x W_mark / H + 0.05** (Kora, 4 letters: 0.66 on a 1080 high stage, 0.59 on 1920). Above y 0.85 the
wordmark is too long: use the short name. Start it 0.75 s after the beat starts (calm 1.0 s), but never later than
`beat end - (0.3 + words / 3.5)` s, the validator's reading time (a 6-word line needs 2.01 s, so in a 3 s calm beat start it at 0.95 s
or earlier). Ease it in over 0.4 s, hold to the end; an opacity key near the end stops polish adding an exit. This section is all a
launch needs; `formats/logo-reveal.md` has a full example if you are building a logo reveal.

## What the validator says about a component (measured, not defects)

Components draw in px for a 1080-wide stage, so these notes come from them, not from your spec. Keep them; say so in your report.

| Component | Vertical or square 1080 | Landscape 1920 |
| --- | --- | --- |
| `big-number`, `logo-outro` (no `sub`), `kinetic-title` (no `sub`) | clean | clean |
| `kinetic-title` with `sub` | clean | `off-scale-type` (34 px kicker) |
| `stat-ring`, `badge-callouts`, `chip-cloud`, `testimonial-cards`, `stat-bars` | clean | `off-scale-type` on the label text |
| `circled-phrase`, `circle` variant, no `sub` | `off-scale-type` (84 px phrase) | clean |
| `circled-phrase`, `underline` or `marker` | the above plus `sparse-beat` (add 2-3 raw parts) | `sparse-beat` |
| `circled-phrase` with `sub` | `off-scale-type` | `off-scale-type` (36 px lead-in) |
| `checklist` | `off-scale-type`, `off-margin` (left rows), `clamped` (inter 500 -> 400) | the same |
| `clock-sweep`, `comparison`, `quote-card` | `off-scale-type` (44 px caption or headers, 220 px quote mark) | the same |
| `section-break` | `off-scale-type` (68 px word), `off-margin` (the word starts off-frame) | `off-margin` only |
| `icon-row` | `hard-cut` 0.15-0.2 s where it starts (first icon arrives late): overlap the beat before (`craft/motion.md`, Hand-off) | the same |
| `typewriter-line` | `sparse-beat` (add 2-3 raw parts), `off-scale-type`, `off-margin` | the same |
| `word-hits` | `accent-overuse` with 4+ items (it alternates accent), `sparse-beat` when 3 items run 4 s, `unreadable-hold` under 0.7 s per word | the same, plus `off-scale-type` (140 px words) |

Landscape practice: raw elements in the landscape bands carry hero lines and split layouts; components are centrepieces (`stat-ring`,
`big-number`, `circled-phrase`, `logo-outro`, `icon-row`) at an `x` that suits the layout.

## Systems (kind `system`, behaviours on sibling elements)

`targets` are ids of siblings at the same level; `params` are `{ name, value }` rows; times are seconds from the video start.
`camera` (move push / pan / zoomOut / whip, amount 0.12 = 12% zoom): one move per beat. `radialPush` (a pulse pushes targets
outward). `arrange` (targets snap into a grid / ring / row on a spring). `swarm` (a template multiplied across a region).
`freeze` (stop targets mid-move). `crossMorph` (one element becomes another). At most one system per beat, only where the idea needs it.

```json
{
  "format": "elah-input", "version": 1, "title": "System camera",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "System camera", "format": { "width": 1080, "height": 1920, "fps": 30 }, "duration": 5,
    "background": "$bg", "motion": { "energy": "standard", "camera": false, "ambient": "none", "transition": "cut" },
    "design": {
      "colors": [ { "name": "bg", "value": "#0b0f14" }, { "name": "ink", "value": "#f4f6f8" }, { "name": "muted", "value": "#8a94a3" },
        { "name": "accent", "value": "#5eead4" }, { "name": "accentSoft", "value": "#134e4a" }, { "name": "surface", "value": "#151b24" } ],
      "fonts": [ { "role": "sans", "font": "inter" } ]
    },
    "elements": [
      { "id": "a", "kind": "shape", "shape": "rect", "at": 0, "duration": 5, "w": 260, "h": 260, "radius": 40, "fill": "$surface", "x": 0.3, "y": 0.4, "enter": "pop-in" },
      { "id": "b", "kind": "shape", "shape": "rect", "at": 0.2, "duration": 4.8, "w": 260, "h": 260, "radius": 40, "fill": "$accent", "x": 0.7, "y": 0.4, "enter": "pop-in" },
      { "id": "t", "kind": "text", "at": 0.4, "duration": 4.6, "text": "Two cards, one camera", "font": "$sans", "size": 64, "color": "$ink", "maxWidth": 800, "x": 0.5, "y": 0.62, "enter": "fade-in" },
      { "id": "cam", "kind": "system", "system": "camera", "at": 0.5, "duration": 4, "targets": ["a", "b", "t"], "params": [ { "name": "move", "value": "push" }, { "name": "amount", "value": 0.08 } ] }
    ]
  } }
}
```
