# Type and layout craft

The validator's `off-scale-type`, `off-margin`, `accent-overuse` and `sparse-beat` lints are these rules. Stay inside them and the
warnings never appear.

## Type bands (the lint measures `size` against stage WIDTH, normalised to 1080 wide)

| Role | 1080 wide (vertical, square) | 1920 wide (landscape) | Use |
| --- | --- | --- | --- |
| Headline | 96-140 | 172-248 | the one hero line of a beat; 2-6 words |
| Support | 48-64 | 86-114 | the sentence under it, a label, a feature name |
| Caption | 30-38 | 54-68 | source line, tag, URL, small label |

- Sizes between bands (72-90 at 1080, 120-165 at 1920) are always flagged. Pick a band, never the gap.
- Hierarchy is scale contrast: the headline at least 2x the support, support at least 1.5x the caption. Everything at one size is a list.
- A number larger than the headline band: use the `big-number` component or a `counter` generator (`fontSize` 200-400); the lint reads text `size` only.
- Weights must exist for the font: inter 400/700/900, montserrat 400/700/900, poppins 400/600/800, space-grotesk 400/700,
  playfair-display 400/700/900, dm-serif-display 400, oswald 400/700, roboto-mono 400/700; bebas-neue, anton and archivo-black only 400.
  Anything else (inter 500) is clamped with a warning.
- Two fonts at most: one display or serif for headlines, one sans for support. A third face is the first thing to cut.
  The validator's "N fonts" counts what is drawn, and components draw through roles: `sans` (all of them), `serif`
  (`kinetic-title` emphasis words, `quote-card`, `word-hits`), `display` (`logo-outro` wordmark, `typewriter-line` ghost word,
  `word-hits`), `mono` (`typewriter-line`). A role you did not declare falls back to its default (serif playfair-display, display
  bebas-neue, mono roboto-mono) and becomes a third font. So declare every role your components use and point it at one of your
  two families (`{ "role": "serif", "font": "space-grotesk" }`); the one allowed exception is a deliberate serif-italic accent on
  `kinetic-title` emphasis words, which counts as the accent, not a third voice.
- Components draw their text in fixed pixels sized for a 1080-wide stage, so on a 1920-wide stage their small text (about 30-48 px)
  sits under the landscape bands. That is expected and listed in `components.md`; raw text you write follows the table above.
  The one exception: a `logo-outro` tagline is raw text of your own, never the component's `sub`.
- Headlines: line height 1.0-1.15, `letterSpacing` -1 to -3 on large serif or display type, +4 to +6 on small all-caps labels.
  Copy: titles up to 6 words, one line when possible, no trailing period; explainer lines up to 10 words.

## Margins and safe areas

- Text boxes stay inside 6% of each side (lint `off-margin`); aim for 8%, 10% for editorial. The check uses `maxWidth`, or a rough
  guess (characters x size x 0.56) when you gave none, so always set `maxWidth` on anything long.
- `x` is the centre of the text box. For left-aligned text set `align: "left"`, `maxWidth: M`, and `x = margin + M / 2 / stageWidth`
  (landscape, 8% margin, M 1000: x = 0.08 + 500 / 1920 = 0.34).
- Vertical 1080x1920: words and the product between y 0.10 and 0.72; below that only decoration or the last-beat call to action,
  because the platform's caption, handle and buttons cover the bottom 20%. Keep 6% off the right edge for the action buttons.
- The optical centre sits a little above the middle: hero at y 0.40-0.48.

## Composition

- One hero per beat: the one thing the eye lands on first. A beat has a primary (the message), secondary graphics that support it
  (icon, rule, counter, badge) and decoration that frames it (dot, ring, bracket, drawn underline): 5-12 parts, never fewer than 3
  visible at any moment (`sparse-beat`, except one huge text of 120+ px by itself).
- Do not centre everything. Put the weight on one edge, use the rule of thirds for the hero (x or y near 0.33 or 0.67) and leave
  generous empty space around it; leave 40-60% of the frame empty in calm styles.
- Landscape: build a split (text on one 45%, graphic on the other 55%) instead of a centred stack; vertical: stack top to bottom, one
  subject. Never rebuild a landscape side-by-side as a tiny vertical pair.
- A component owns its region (`components.md`, Regions: by default x 0.08-0.92, y 0.25-0.75, or the box its own `x`/`y`/`w`/`h`
  give). Raw text in the same beat sits outside it: the top band (y <= 0.20), the bottom band (y >= 0.80), or the other side of a
  component you moved, 0.03 clear. Check: the raw box `x ± maxWidth/2/W`, `y ± size x 1.15/2/H` must not touch the component's
  box. No box to respect means the beat is raw elements only, or the component alone.
- Depth (dark-glass and editorial; minimal and brutalist use none): `layer` -1 for ambient, 0 for most, 1-2 for the hero; a card is
  a `rect` with `radius` in `$surface` over a soft shadow (a second rect in `$ink`, opacity 0.08-0.12, offset down 12 px,
  `gaussianBlur` radius 24-40). No hard black shadows.
- Colour: the accent on about 10% of the frame (the emphasis word, the highlighted icon, one rule, one dot). Lint `accent-overuse`
  fires when more than 35% of the text elements use `$accent`. Ink and `$muted` carry the rest.
- Emphasis in another face is its own element anchored with `layout.anchorTo` (a span cannot change the family and is ignored while a
  `reveal` runs). Prefer `kinetic-title` with `emphasis`, which does this for you.

```json
{
  "format": "elah-input", "version": 1, "title": "Type bands",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Type bands", "format": { "width": 1920, "height": 1080, "fps": 30 }, "duration": 4,
    "background": "$bg", "motion": { "energy": "standard", "camera": false, "ambient": "none", "transition": "cut" },
    "design": {
      "colors": [ { "name": "bg", "value": "#f7f7f5" }, { "name": "ink", "value": "#111111" }, { "name": "muted", "value": "#6b6b6b" },
        { "name": "accent", "value": "#16a34a" }, { "name": "accentSoft", "value": "#bbf7d0" }, { "name": "surface", "value": "#ffffff" } ],
      "fonts": [ { "role": "sans", "font": "inter" } ]
    },
    "elements": [
      { "id": "h", "kind": "text", "at": 0, "duration": 4, "text": "Fewer, better.", "font": "$sans", "weight": 700, "size": 220, "color": "$ink",
        "align": "left", "maxWidth": 1000, "x": 0.34, "y": 0.4, "letterSpacing": -3, "reveal": { "preset": "word-fade", "stagger": 0.1, "duration": 0.4 } },
      { "id": "s", "kind": "text", "at": 0.5, "duration": 3.5, "text": "Built for people who ship.", "font": "$sans", "size": 96, "color": "$muted",
        "align": "left", "maxWidth": 1000, "x": 0.34, "y": 0.6, "enter": "slide-in-up" },
      { "id": "c", "kind": "text", "at": 1.1, "duration": 2.9, "text": "NOTELY.APP", "font": "$sans", "weight": 700, "size": 56, "color": "$ink",
        "align": "left", "maxWidth": 600, "x": 0.236, "y": 0.86, "letterSpacing": 5, "enter": "fade-in" },
      { "id": "dot", "kind": "shape", "shape": "circle", "at": 0.9, "duration": 3.1, "w": 28, "h": 28, "fill": "$accent", "x": 0.095, "y": 0.4, "enter": "pop-in" }
    ]
  } }
}
```
