# Programmatic video: the video is one HTML + CSS document

Read this instead of `authoring.md`'s VideoSpec sections when `director.md` picks Medium = programmatic (the default). The craft
rules (taste, type bands, beat sheet, review) still apply; `programmatic/motion.md` turns the motion numbers into CSS;
`programmatic/recipes.md` holds ready beats (headline with an emphasis word, word hits, count-up, circled phrase, logo outro...).
Preview and export show your HTML and CSS exactly as you wrote them; keyframes appear only when the person presses Edit, so every
choice of curve, delay and layout here is the final picture.

Naming: users call this **programmatic video** (a short graphic is **programmatic motion**). In your replies, notes and the
artifact description use those words only. The JSON key `source.kind: "page"` is internal and stays; never describe the video to the
user as a page.

## Input shape

```json
{ "format": "elah-input", "version": 1, "title": "Orbit 2 launch",
  "source": { "kind": "page", "html": "<main class=\"stage\">...</main>", "css": ".stage { ... }",
              "durationSeconds": 6, "stage": { "width": 1920, "height": 1080 }, "fps": 30 } }
```

`durationSeconds` > 0; `stage` positive integers (1920x1080 landscape, 1080x1920 vertical, 1080x1080 square); `fps` an integer 24-60
(30 unless the brief wants smoother). `html` is a fragment placed inside a stage box of exactly that size (`position: relative;
overflow: hidden`): no `<html>`, `<head>`, `<body>`, doctype. `css` is a separate string. Markup at most 64 KB, CSS at most 32 KB.
Images the person supplied are files in `assets/` beside the input, not inline data (see "Supplied images" below).

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
   An animation with `both` also overrides the element's resting style: a track styled `opacity: 0.35` that arrives with `fade-in`
   (to 1) ends at 1. Give a dimmed element its own keyframes that end at its resting value (`@keyframes fade-dim { to { opacity: 0.35 } }`).
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

`url()` accepts only `data:`, `#fragments` and `assets/<name>` (a supplied image, below). Draw with elements, `border-radius`, `linear-gradient`/`radial-gradient`/`conic-gradient`,
`box-shadow`, `clip-path`, `mix-blend-mode`, `backdrop-filter`, and inline `<svg>` (paths, `stroke-dasharray` / `stroke-dashoffset`
draw-on, `<defs>` gradients and masks). No `<img src="https://...">`, `<script>`, `on*=` attributes, `<iframe>`, `<video>`, `<audio>`,
`<link>`, `<style>`, `<meta http-equiv>`. Invent no logo, screenshot or photo; draw a generic shape and say so.

## Supplied images (a logo, product shots, screenshots)

Only files the person gave you, in this conversation or in their project. Never draw, trace, recreate or invent a logo, a product
shot or a screenshot; if the brief needs one that was not supplied, draw a neutral placeholder shape and say so in your reply.

1. Copy each file into `<work>/assets/`, the folder that holds `elah-input.json`. One level only: `assets/logo.png`, never
   `assets/brand/logo.png`. Name it with letters, digits, `.`, `_` and `-` (rename `My Logo.png` to `logo.png`).
2. Reference it as `assets/<name>` (or `./assets/<name>`): `<img class="logo" src="assets/logo.png" alt="Acme">` or
   `background: url(assets/shot.jpg) center / cover`. Nothing else: no `..`, no absolute path, no other folder, no network URL.
3. Types: PNG, JPEG, WebP, SVG (`.png`, `.jpg`/`.jpeg`, `.webp`, `.svg`; the contents must match the extension). Convert anything
   else (GIF, HEIC, PDF) first, or ask for another file.
4. Limits: at most 15 MB per file and 40 MB for all images together (the artifact publishes page, engine and images in one call).
   Export rebuilds and decodes every image on every frame, so file size is export time. Measured 2026-10-26 (180 frames,
   1080p30): small images add nothing (about 1.5 s either way), but one 6.2 MB 1920x1080 PNG made the export about 16 times
   slower (24 s). Keep each image near the size it is shown and small on disk:
   - a logo: SVG when the person has one, otherwise a PNG a few hundred px wide;
   - a photo or screenshot: JPEG or WebP, at most about 2x its on-screen box and never wider than 1920 px, aiming under
     500 KB per file;
   - resize or re-encode a large file (a 4000 px photo, a multi-MB PNG screenshot) before you copy it in, and tell the
     person you did. If you cannot resize it, say the export will be slow.
5. Give every `<img>` a `position: absolute` box with both `width` and `height` in px, the image's own aspect ratio (or
   `object-fit: cover` / `contain`). An SVG file needs `width` and `height` attributes on its root `<svg>` (a `viewBox` alone
   has no natural size).
6. Animate the `<img>` with `opacity` and `transform` like any element (`logo-in`, a scale settle, a slow push on a product shot).
   Logos are not recoloured, cropped, skewed or filtered; a logo sits on a calm background with room around it.

The validator resolves every `assets/<name>` against the input's folder and refuses a missing file, an unsupported type, a file over
15 MB, more than 40 MB in total, and any path that leaves `assets/`. `stage.mjs` adds every file in `<work>/assets/` to the `files`
map as `assets/<name>`, so the images are published beside the page.

## Sound cues (`data-sfx`)

A programmatic video carries sound effects from the bundled CC0 pack; there are no audio files and no music or voice-over here.

- Mark the element whose arrival the sound belongs to: `<h1 class="hero" data-sfx="whoosh">`. Optional loudness:
  `data-sfx-gain="0.5"` (0 to 1, default 0.6; keep it at or under 0.7 so the sound sits under the picture). A scene root may carry
  one too (`<section data-scene="close" data-sfx="swoosh">`): it plays when the scene's first animation starts.
- Words: `whoosh` (a big move or scene change), `swoosh` (a quick slide or wipe), `pop` (a badge, dot or card popping in), `click`
  (a UI tap, a toggle), `tick` (a line drawing, a counter step), `snap` (parts locking into place), `impact` (a heavy word hit or
  logo slam), `chime` (the call to action, a success). `ding` = chime, `swish` = swoosh. Any other word is a validator error, except the path of a searched sound (below).
- Timing is automatic: the cue plays at the element's first animation start (its delay, `--at` included; the earliest animation on
  the element or inside it; a negative delay plays at 0 s). Move the cue by moving the animation, never with another attribute.
- Place cues only where something lands: arrivals, impacts, the call to action. At most one per beat, never one per word or per
  list item, nothing on ambient loops. The validator warns when two cues are closer than 0.25 s or there are more than 24.
- Sound is on unless the brief says silent (or the platform plays muted and the person said so); say in your reply whether the
  video has sound and offer the other in one line. A silent video simply has no `data-sfx`.

### Sounds beyond the pack

A sound the eight words do not cover comes from Openverse, searched while you build (see `authoring.md`, "Sounds beyond the pack": `scripts/sfx-search.mjs`, CC0 only, at most 4 per video). Put the downloaded file's path in the attribute: `<div class="crowd" data-sfx="assets/sfx/crowd-cheer.mp3">`. The same timing, gain and spacing rules apply; the validator checks the file exists in `assets/sfx/` beside the input, is an MP3 and is at most 2 MB. Name each searched sound and its author in the closing note.

Preview plays the cues in sync after the viewer presses Play (browsers allow sound only after a click) and follows seeks and
pauses. Export mixes them into the MP4 (AAC). Edit turns each cue into an audio clip named `sfx · <cue>` at its time on a
"Sound effects" track.

## What Edit converts (so choose what to animate knowing it)

Converts to keys: `opacity`, `transform` (translate, scale, rotate; the same function list in every keyframe), SVG
`stroke-dashoffset`, `cubic-bezier()` and `steps()` curves, delays, fill and iterations (unrolled). An `<img src="assets/...">`
becomes an image clip with the same box and those keys. Reported and left at the resting state: colour or `background`
animation, a CSS `url(assets/...)` background image (use an `<img>` when the image must stay editable), `backdrop-filter`, 3D
transforms, `clip-path` morphs, custom-property animation (so a count-up is a digit reel of `translateY`, never an `@property`
counter; see `programmatic/recipes.md`). Sound cues become audio clips (above). `filter: blur()` is a polish move that may be reported; the resting state is always correct. Anything reported keeps working in Preview and
Export until Edit, and "Revert to original" brings it back.

## Procedure

Direct as `director.md` says (defaults, beat sheet, taste), then: write `elah-input.json` with `kind: "page"`; run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --notes "<file>"`; fix every error; self-review with `craft/review.md` (the
items that apply to a programmatic video: beat sheet, reading holds, hook, accent budget, one transition family, facts) and the
validator warnings (a warning is fixed or kept on purpose, and said). At most three validation rounds.

A complete, validated 6 s two-scene programmatic video (HTML, CSS and the beat read) is in `programmatic/example.md`; copy its
structure, not its words. Ready recipes for the beats the formats name (a count-up, a circled phrase, a logo outro, an icon row...)
are in `programmatic/recipes.md`; they keep their time in `--at` on the scene, so a recipe drops into any scene of the example.
