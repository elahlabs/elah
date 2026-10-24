# Page route: the video is one HTML + CSS page

Read this instead of `authoring.md`'s VideoSpec sections when `director.md` picks Medium = page. The craft rules (taste, type bands,
beat sheet, review) still apply; `page/motion.md` turns the motion numbers into CSS. Preview and export show your page exactly as you
wrote it; keyframes appear only when the person presses Edit, so every choice of curve, delay and layout here is the final picture.

## Input shape

```json
{ "format": "elah-input", "version": 1, "title": "Orbit 2 page",
  "source": { "kind": "page", "html": "<main class=\"stage\">...</main>", "css": ".stage { ... }",
              "durationSeconds": 6, "stage": { "width": 1920, "height": 1080 }, "fps": 30 } }
```

`durationSeconds` > 0; `stage` positive integers (1920x1080 landscape, 1080x1920 vertical, 1080x1080 square); `fps` an integer 24-60
(30 unless the brief wants smoother). `html` is a fragment placed inside a stage box of exactly that size (`position: relative;
overflow: hidden`): no `<html>`, `<head>`, `<body>`, doctype. `css` is a separate string. Markup at most 64 KB, CSS at most 32 KB.

- One root: `<main class="stage">` with `position: absolute; inset: 0; background: var(--bg)`. The selectors `html`, `body`, `:root` do
  not match inside the stage: put the custom properties and base type on `.stage`.
- Each scene is a direct child section of that root with `data-scene="name"`; the name labels the timeline and the Edit report.

## Time rules (the video clock is the document's animation time from 0)

1. Every animation states a duration and a delay in seconds: `animation: rise 0.6s var(--arrive) 1.2s both`. The delay is the
   timeline; there is no script, so there is no other clock. A custom property for a curve or `calc(var(--at) + var(--i) * 0.08s)` for
   a delay is fine.
2. Always `animation-fill-mode: both` on anything with a delay (the `both` keyword at the end of the shorthand). Without it the element
   shows its resting style until the delay ends, then jumps.
3. A scene is a sibling section with its own delay window. Scene 1 starts visible and fades out on the section root (0.4 s, at the
   handoff time); scene 2 starts at `opacity: 0` and fades in on its root over the same 0.4 s, so they cross-dissolve. Put the scene
   fade on the section and the arrivals on its children: never two animations on the same property of one element (the later one wins
   even before its delay). A middle scene needs a fade-in and a fade-out, so give it one wrapper child:
   `<section class="s2" data-scene="b"><div class="in">...</div></section>` with `scene-out` on the section and `scene-in` on `.in`
   (`.in { position: absolute; inset: 0 }`); the same rule keeps a pop and a move on one element in separate wrappers.
4. The last scene never exits. It arrives, then holds to `durationSeconds` (the end state is the thumbnail of the finished video).
5. Frame 0 is the thumbnail: give the hook a negative delay (`-0.15s`) so it is already part-way in at t = 0; the first frame is
   never empty.
6. Everything finishes by `durationSeconds`: the last `delay + duration` is at most that (validator warning otherwise).
7. `infinite` is allowed and seek handles it, but nothing should move after a title lands, so use it only for a deliberate loop.
8. Not allowed (the validator refuses, naming the substitute): `animation-play-state` (also `paused` in the shorthand),
   `animation-timeline`, `transition` (nothing triggers it), SMIL `<animate>`/`<set>`.

## Stage and layout

- Everything is `position: absolute` in px of the stage (`left`, `top`, `width`). Flow layout drifts between preview and export.
- Margins: text boxes stay 6% in (landscape 115 px, vertical 65 px); aim 8% (landscape 160, vertical 90), 10% for editorial.
  Vertical: words and product between 10% and 72% of height (y 190-1380); the bottom 20% belongs to platform captions.
- Type bands in px (same as `craft/type-and-layout.md`): headline 172-248 landscape / 96-140 vertical; support 86-114 / 48-64;
  caption 54-68 / 30-38. Never between bands. Line height 1.0-1.15. Set a `width` on every text so it wraps where you chose.
- Hero at y 40-48% of height; leave 40-60% of the frame empty in calm tastes; one thing the eye lands on per scene.

## Fonts

Only the twelve bundled families, by bare id: `font-family: inter, sans-serif`. Real weights: inter, montserrat 400/700/900;
poppins 400/600/800; space-grotesk, oswald, roboto-mono, caveat 400/700; playfair-display 400/700/900; dm-serif-display, bebas-neue,
anton, archivo-black 400 only. Italics exist for inter, montserrat, poppins, playfair-display, dm-serif-display. Any other weight is
faked by the browser: do not write it. Use two families. `sans-serif`, `serif`, `monospace` are allowed only as the last fallback.
No `@font-face`, no `@import`, no `font:` shorthand (it hides the family).

## Pictures with no network

`url()` accepts only `data:` and `#fragments`. Draw with elements, `border-radius`, `linear-gradient`/`radial-gradient`/`conic-gradient`,
`box-shadow`, `clip-path`, `mix-blend-mode`, `backdrop-filter`, and inline `<svg>` (paths, `stroke-dasharray` / `stroke-dashoffset`
draw-on, `<defs>` gradients and masks). No `<img src="https://...">`, `<script>`, `on*=` attributes, `<iframe>`, `<video>`, `<audio>`,
`<link>`, `<style>`, `<meta http-equiv>`. Invent no logo, screenshot or photo; draw a generic shape and say so.

## What Edit converts (so choose what to animate knowing it)

Converts to keys: `opacity`, `transform` (translate, scale, rotate; the same function list in every keyframe), SVG
`stroke-dashoffset`, `cubic-bezier()` and `steps()` curves, delays, fill and iterations (unrolled). Reported and left at the resting
state: colour or `background` animation, `backdrop-filter`, 3D transforms, `clip-path` morphs, custom-property animation. `filter:
blur()` is a polish move that may be reported; the resting state is always correct. Anything reported keeps working in Preview and
Export until Edit, and "Revert to original" brings it back.

## Procedure

Direct as `director.md` says (defaults, beat sheet, taste), then: write `elah-input.json` with `kind: "page"`; run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --notes "<file>"`; fix every error; self-review with `craft/review.md` (the
items that apply to a page: beat sheet, reading holds, hook, accent budget, one transition family, facts) and the validator warnings
(a warning is fixed or kept on purpose, and said). At most three validation rounds.

A complete, validated 6 s two-scene page (HTML, CSS and the beat read) is in `page/example.md`; copy its structure, not its words.
