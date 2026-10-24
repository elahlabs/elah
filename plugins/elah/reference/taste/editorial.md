# Taste: editorial

Read `floor.md` too. Calm, serif-led, paper and grain: fashion, hospitality, property, beauty, a founder story, a pull quote, an
opening title. Not for fast social energy. Numbers are starting values; adapt them to the clip. The motion block and components below
are the VideoSpec's; for a programmatic video read the taste as tokens, curves and recipes in `programmatic/motion.md` and
`programmatic/recipes.md`.

## Palette (all six tokens) and fonts

`paper-crimson` (cool paper), or `golden-hour` / `rose-dust` / `forest-sage` for warm, soft or green brands. From `themes.md`:

| bg | ink | muted | accent | accentSoft | surface |
| --- | --- | --- | --- | --- | --- |
| #f4efe6 | #1b1a17 | #6f6a60 | #b3261e | #ecd0cb | #fffaf0 |

Fonts: `serif: playfair-display` (or `dm-serif-display`) for the headline at weight 400, never bold; `sans: inter` for labels and body.
Declare the `serif` role so `kinetic-title` sets its emphasis word in the serif italic.

## Motion block

`"motion": { "energy": "calm", "camera": true, "ambient": "grain", "transition": "crossfade" }`. One mover at a time, 6 frames
(0.2 s) apart. Arrivals on `spring:gentle`; headline reveal `line-rise` (lines 0.2 s apart) or `char-fade`; labels `fade-in`.
Rules draw on with `draw` (`cubic-out`, 0.8 s). Beats hand off with one crossfade family only. These times (0.2 s, 0.8 s) are already
calm: do not scale them again (`craft/motion.md`, Energy).

## Type, colour and layout

- Headline: serif 400, 172-248 px landscape (96-140 vertical), `letterSpacing` -1 to -3, two or three lines at most, ragged right.
  One emphasis word as its own element in serif italic, in `$accent`. Labels and body in sans 54-68 landscape (30-38 vertical); labels
  in caps with `letterSpacing` +3 to +6.
- Asymmetric: headline flush left on a 8-10% margin, the largest empty area at least a third of the frame. A credit or label in the
  opposite corner. One 2 px hairline rule, about 20% of the frame wide, above the headline. A photograph (only if the user supplied
  a URL) takes a full half and text never sits on its busy part; drift it with `ken-burns`, 3-5% over the beat.
- Colour: paper ground, ink text; the accent on one word or one hairline per beat, about a tenth of the frame.

## Components and presets

`kinetic-title` (the editorial opener), `quote-card`, `circled-phrase` (variant `underline`), `big-number` for one figure,
`logo-outro` to close. Raw: reveal `line-rise` / `char-fade`, enter `fade-in`, `blur-in`, `underline-draw`; exit `fade-out`.

## Avoid

Bold or all-capital headlines. Stacks of three centred lines. Badges, bursts, stickers. A transition on every cut. Glow, glitch,
scanlines. More than 12 words on screen at once.

```json
{
  "format": "elah-input", "version": 1, "title": "Editorial opening",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Editorial opening", "format": { "width": 1920, "height": 1080, "fps": 30 }, "duration": 5,
    "background": "$bg", "motion": { "energy": "calm", "camera": true, "ambient": "grain", "transition": "crossfade" },
    "design": {
      "colors": [ { "name": "bg", "value": "#f4efe6" }, { "name": "ink", "value": "#1b1a17" }, { "name": "muted", "value": "#6f6a60" },
        { "name": "accent", "value": "#b3261e" }, { "name": "accentSoft", "value": "#ecd0cb" }, { "name": "surface", "value": "#fffaf0" } ],
      "fonts": [ { "role": "serif", "font": "playfair-display" }, { "role": "sans", "font": "inter" } ]
    },
    "elements": [
      { "id": "rule", "kind": "shape", "shape": "line", "at": 0, "duration": 5, "w": 380, "h": 2, "stroke": "$ink", "strokeWidth": 2, "x": 0.179, "y": 0.2,
        "draw": { "duration": 0.8, "curve": "cubic-out" }, "enter": "fade-in" },
      { "id": "head", "kind": "text", "at": 0.3, "duration": 4.7, "text": "Slow mornings", "font": "$serif", "weight": 400, "size": 220, "color": "$ink",
        "align": "left", "maxWidth": 1300, "x": 0.4185, "y": 0.42, "letterSpacing": -2, "reveal": { "preset": "line-rise", "stagger": 0.2, "duration": 0.7 } },
      { "id": "emph", "kind": "text", "at": 1.0, "duration": 4, "text": "in the hills", "font": "$serif", "italic": true, "size": 112, "color": "$accent",
        "align": "left", "maxWidth": 900, "x": 0.3144, "y": 0.64, "enter": "fade-in" },
      { "id": "label", "kind": "text", "at": 1.4, "duration": 3.6, "text": "THE SPRING ISSUE", "font": "$sans", "size": 56, "color": "$muted",
        "align": "left", "maxWidth": 700, "x": 0.2623, "y": 0.86, "letterSpacing": 5, "enter": "fade-in" }
    ]
  } }
}
```
