# Programmatic recipes: the formats' beats as HTML + CSS

Each `formats/*.md` beat table names VideoSpec components. This file is the same beats for a programmatic video (`source.kind:
"page"`, read `programmatic.md` first). Every recipe is one scene (`<section class="scene ..." data-scene="...">`) plus its CSS, and
every block here is validated: all of them composed into one video pass `validate.mjs` with 0 errors (`scripts/validate.test.mjs`
keeps it so).

## How to use a recipe

- Copy the recipe's section into your `<main class="stage">` and its CSS into the `css` string, after the shared base below (once per
  video; do not copy a keyframe set twice).
- **Time lives in `--at`**: set `style="--at: 6s"` on the section and the whole recipe starts there; inside it every delay is
  `calc(var(--at) + ...)`. Scenes hand off with `scene-in` / `scene-out` on the section root as `programmatic.md` rule 3 says. The first
  scene's hook takes a small negative offset (`--at: -0.15s`) so frame 0 is never empty.
- The seconds written here are the standard recipe. Scale them once for the taste's energy (`craft/motion.md`, Energy): calm x1.3,
  bold x0.75; the figures a taste file gives are already scaled, so leave those alone.
- Positions are px of a 1920x1080 stage on the 8% margin (160 px) and the type bands of `craft/type-and-layout.md`. For 1080x1920,
  keep the animation lines and rebuild the positions as a stack inside y 190-1380 with the vertical bands.
- The words are placeholders; use the brief's own names, numbers and claims. A programmatic video draws everything: no `image`, no
  logo file, no sound.
- Colours are tokens, fonts are `--sans`, `--display`, `--serif`, `--mono` (set them to the taste's two families; `anton` in the
  recipes that say so is the brutalist display face). Two families per video.
- Tables of which recipe serves which component: the "Programmatic" column in each `formats/*.md` beat table; the whole index is below.

| VideoSpec component or system | Recipe |
| --- | --- |
| `kinetic-title` | [Kinetic title](#kinetic-title) |
| `word-hits` | [Word hits](#word-hits) |
| `typewriter-line` | [Typewriter line](#typewriter-line) |
| `circled-phrase` | [Circled phrase](#circled-phrase) |
| `quote-card` | [Quote card](#quote-card) |
| `clock-sweep` | [Clock sweep](#clock-sweep) |
| `logo-outro` | [Logo outro](#logo-outro) |
| `section-break` | [Section break](#section-break) |
| `big-number`, `counter` generator | [Count-up (digit reel)](#count-up-digit-reel) |
| `stat-ring` | [Stat ring](#stat-ring) |
| `stat-bars` | [Stat bars](#stat-bars) |
| `icon-row` | [Icon row](#icon-row) |
| `badge-callouts` | [Badge callouts](#badge-callouts) |
| `chip-cloud` | [Chip cloud](#chip-cloud) |
| `checklist` | [Checklist](#checklist) |
| `comparison` | [Comparison](#comparison) |
| `testimonial-cards` | [Testimonial cards](#testimonial-cards) |
| `arrange` system | [Parts snap into a layout](#parts-snap-into-a-layout) |
| `crossMorph` system | [Steps that swap](#steps-that-swap) |
| `camera` system (push) | `.cam` wrapper in `programmatic/motion.md`, "Arrivals, exits, holds" |

## Shared base

Tokens (dark-glass here; swap them for the taste, `programmatic/motion.md`), the curves by role, the scene box, the type bands and the
keyframes every recipe reuses. Put this first in the `css` string.

```css
.stage {
  --bg: #0b0f14; --ink: #f4f6f8; --muted: #8a94a3; --accent: #5eead4; --accent-soft: #134e4a; --surface: #151b24;
  --sans: inter, sans-serif; --display: space-grotesk, sans-serif; --serif: playfair-display, serif; --mono: roboto-mono, monospace;
  --arrive: cubic-bezier(0.19, 1, 0.22, 1);
  --settle: cubic-bezier(0.22, 1, 0.36, 1);
  --pop: cubic-bezier(0.34, 1.56, 0.64, 1);
  --punch: cubic-bezier(0.175, 0.885, 0.32, 1.275);
  --draw: cubic-bezier(0.215, 0.61, 0.355, 1);
  --travel: cubic-bezier(0.65, 0, 0.35, 1);
  --exit: cubic-bezier(0.55, 0.055, 0.675, 0.19);
  position: absolute; inset: 0; overflow: hidden; background: var(--bg); color: var(--ink);
  font-family: var(--sans); font-weight: 400;
}
.scene { --at: 0s; position: absolute; inset: 0; }
.scene > * { position: absolute; margin: 0; }
.cap { left: 160px; width: 1000px; font-family: var(--display); font-size: 54px; letter-spacing: 6px; color: var(--muted); }
.hero { left: 160px; width: 1500px; font-size: 200px; line-height: 1.05; letter-spacing: 3px; }
.sub { left: 160px; width: 1300px; font-size: 86px; line-height: 1.1; }
.em { color: var(--accent); }
.rule { left: 160px; width: 360px; height: 2px; background: var(--muted); transform-origin: left center; }

@keyframes rise { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
@keyframes pop { from { opacity: 0; transform: scale(0.35); } to { opacity: 1; transform: scale(1); } }
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes slide-x { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: none; } }
@keyframes blur-in { from { opacity: 0; filter: blur(12px); transform: translateY(24px); } to { opacity: 1; filter: blur(0); transform: none; } }
@keyframes draw-x { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes draw-stroke { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
```

## Kinetic title

`kinetic-title`: the opening or any message beat; one emphasis word in the accent. Words blur in 0.1 s apart, a kicker slides in, a
rule draws. Editorial taste: set `.t-line .em` to `font-family: var(--serif); font-style: italic`.

```html
<section class="scene r-title" data-scene="title">
  <p class="cap t-kicker">NOW SHIPPING</p>
  <h1 class="hero t-line"><span class="w" style="--i: 0">Video</span> <span class="w" style="--i: 1">in</span> <span class="w em" style="--i: 2">code</span></h1>
  <span class="rule t-rule"></span>
</section>
```

```css
.t-kicker { top: 330px; animation: slide-x 0.6s var(--arrive) calc(var(--at) + 0.25s) both; }
.t-line { top: 400px; }
.t-line .w { display: inline-block; animation: blur-in 0.9s var(--arrive) calc(var(--at) + var(--i) * 0.1s) both; }
.t-rule { top: 660px; animation: draw-x 0.8s var(--draw) calc(var(--at) + 0.9s) both; }
```

## Word hits

`word-hits`: 3-8 single words punching in, one at a time, each 0.7 s; the last stays. One keyframe set holds a word and takes it out, so
a word never has two animations on its opacity; the last word has its own set with no exit. Brutalist face: `anton`, capitals.

```html
<section class="scene r-hits" data-scene="hits">
  <p class="cap h-tag">01 / 04</p>
  <p class="hit" style="--i: 0">MAKE</p>
  <p class="hit" style="--i: 1">EVERY</p>
  <p class="hit" style="--i: 2">SECOND</p>
  <p class="hit hit-last em" style="--i: 3">COUNT</p>
  <span class="rule h-rule"></span>
</section>
```

```css
.h-tag { top: 250px; font-family: var(--mono); font-weight: 700; animation: fade-in 0.3s var(--arrive) calc(var(--at) + 0.1s) both; }
.hit { left: 160px; top: 380px; width: 1600px; font-family: anton, sans-serif; font-size: 240px; line-height: 1; letter-spacing: -3px; animation: hit 0.7s var(--exit) calc(var(--at) + var(--i) * 0.7s) both; }
.hit-last { animation: hit-last 0.35s var(--punch) calc(var(--at) + var(--i) * 0.7s) both; }
.h-rule { top: 720px; width: 1400px; height: 4px; background: var(--accent); animation: draw-x 0.5s var(--draw) calc(var(--at) + 0.3s) both; }
@keyframes hit {
  0% { opacity: 0; transform: scale(1.3); animation-timing-function: cubic-bezier(0.175, 0.885, 0.32, 1.275); }
  35% { opacity: 1; transform: scale(1); }
  85% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.96); }
}
@keyframes hit-last { from { opacity: 0; transform: scale(1.3); } to { opacity: 1; transform: scale(1); } }
```

## Typewriter line

`typewriter-line`: one sharp statement typed with a caret. Each letter is an `inline-block` span (an inline span has no box, so Edit
cannot convert it) that steps from 0 to 1 opacity; a space rides inside the letter before it (`e&nbsp;`), because a span holding
only a space draws nothing and Edit reports it. `--i` is the index of the letter in the line, so the caret and the letters keep
one rhythm. The caret is one element stepping across. A monospace face is 0.6 em wide, so the caret travels `letters x 0.6 x font-size` px
(15 letters at 96 px: 864 px) in `steps(15)`. A nowrap line; keep it under 25 letters.

```html
<section class="scene r-type" data-scene="typewriter">
  <p class="cap ty-tag">STATEMENT</p>
  <p class="ty-line"><span style="--i: 0">O</span><span style="--i: 1">n</span><span style="--i: 2">e&nbsp;</span><span style="--i: 4">s</span><span style="--i: 5">h</span><span style="--i: 6">a</span><span style="--i: 7">r</span><span style="--i: 8">p&nbsp;</span><span style="--i: 10">l</span><span style="--i: 11">i</span><span style="--i: 12">n</span><span style="--i: 13">e</span><span style="--i: 14">.</span></p>
  <span class="ty-caret"></span>
</section>
```

```css
.ty-tag { top: 330px; animation: fade-in 0.4s var(--arrive) calc(var(--at) + 0.1s) both; }
.ty-line { left: 160px; top: 420px; width: 1600px; font-family: var(--mono); font-weight: 700; font-size: 96px; line-height: 1.1; white-space: nowrap; }
.ty-line span { display: inline-block; animation: fade-in 0.01s steps(1) calc(var(--at) + 0.4s + var(--i) * 0.07s) both; }
.ty-caret { left: 160px; top: 424px; width: 8px; height: 96px; background: var(--accent); animation: caret-run 1.05s steps(15) calc(var(--at) + 0.4s) both, fade-out 0.3s var(--exit) calc(var(--at) + 2.2s) both; }
@keyframes caret-run { from { transform: translateX(0); } to { transform: translateX(864px); } }
```

## Circled phrase

`circled-phrase`: calling out one phrase. An SVG ellipse is drawn around it (`pathLength="1"` and `stroke-dashoffset`, which Edit
converts). Size the ring from the phrase: width = letters x 0.55 x font-size + 80, height = line height + 110, and centre both on the
same point. Underline variant: swap the ellipse for `<path d="M10 14 Q 265 2 520 12 T 1030 10" pathLength="1"/>` under the phrase.
Marker variant: an `accent-soft` rectangle behind the phrase with `draw-x`.

```html
<section class="scene r-circle" data-scene="circled">
  <p class="cap c-lead">THE OLD WAY</p>
  <p class="sub c-phrase">Every export waits</p>
  <svg class="c-ring" width="1060" height="220" viewBox="0 0 1060 220"><ellipse cx="530" cy="110" rx="515" ry="100" pathLength="1"/></svg>
</section>
```

```css
.c-lead { top: 380px; animation: slide-x 0.6s var(--arrive) calc(var(--at) + 0.2s) both; }
.c-phrase { left: 200px; top: 480px; width: 940px; text-align: center; font-size: 96px; animation: rise 0.6s var(--arrive) calc(var(--at) + 0.4s) both; }
.c-ring { left: 140px; top: 423px; }
.c-ring ellipse { fill: none; stroke: var(--accent); stroke-width: 6; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw-stroke 0.8s var(--draw) calc(var(--at) + 1.1s) both; }
```

## Quote card

`quote-card`: a testimonial or one line worth framing (only words the user supplied). A glass card (`glass-in` ends at 0.7 opacity, so
the card never fights its own fade), a large serif quotation mark, the line, the attribution.

```html
<section class="scene r-quote" data-scene="quote">
  <div class="q-card"></div>
  <p class="q-mark">&ldquo;</p>
  <p class="sub q-text">The quote goes here, in their own words</p>
  <p class="cap q-by">NAME, ROLE</p>
</section>
```

```css
.q-card { left: 210px; top: 240px; width: 1500px; height: 600px; border-radius: 28px; background: var(--surface); border: 1px solid var(--muted); animation: glass-in 0.7s var(--settle) calc(var(--at) + 0.1s) both; }
.q-mark { left: 270px; top: 250px; font-family: var(--serif); font-size: 300px; line-height: 1; color: var(--accent); animation: pop 0.5s var(--pop) calc(var(--at) + 0.4s) both; }
.q-text { left: 330px; top: 430px; width: 1260px; animation: blur-in 0.9s var(--arrive) calc(var(--at) + 0.6s) both; }
.q-by { left: 330px; top: 700px; width: 900px; animation: fade-in 0.5s var(--arrive) calc(var(--at) + 1.4s) both; }
@keyframes glass-in { from { opacity: 0; transform: translateY(40px); } to { opacity: 0.7; transform: none; } }
```

## Clock sweep

`clock-sweep`: time, speed, deadlines. A dial pops in; one hand sweeps a full turn while an accent arc fills behind it in the same
1.6 s `travel` run (the 60 ticks are one dashed circle); the caption rises after.

```html
<section class="scene r-clock" data-scene="clock">
  <div class="cs-dial">
    <svg width="460" height="460" viewBox="0 0 460 460">
      <circle class="cs-face" cx="230" cy="230" r="200"/>
      <circle class="cs-ticks" cx="230" cy="230" r="170"/>
      <circle class="cs-arc" cx="230" cy="230" r="200" pathLength="1"/>
    </svg>
    <span class="cs-hand"></span>
  </div>
  <p class="sub cs-text">Minutes, not days</p>
</section>
```

```css
.cs-dial { left: 330px; top: 310px; width: 460px; height: 460px; animation: pop 0.5s var(--pop) calc(var(--at) + 0.1s) both; }
.cs-dial > * { position: absolute; left: 0; top: 0; }
.cs-face { fill: none; stroke: var(--muted); stroke-width: 4; }
.cs-ticks { fill: none; stroke: var(--muted); stroke-width: 14; stroke-dasharray: 2 15.8; }
.cs-arc { fill: none; stroke: var(--accent); stroke-width: 10; stroke-dasharray: 1; stroke-dashoffset: 1; transform: rotate(-90deg); transform-origin: 230px 230px; animation: draw-stroke 1.6s var(--travel) calc(var(--at) + 0.4s) both; }
.cs-hand { left: 226px; top: 60px; width: 8px; height: 170px; border-radius: 4px; background: var(--ink); transform-origin: 50% 100%; animation: spin-once 1.6s var(--travel) calc(var(--at) + 0.4s) both; }
.cs-text { left: 900px; top: 440px; width: 800px; animation: rise 0.6s var(--arrive) calc(var(--at) + 1.6s) both; }
@keyframes spin-once { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
```

## Logo outro

`logo-outro`: the closing beat, wordmark plus an accent ring plus a tagline; it holds, with no exit. There is no logo file: the
wordmark is type. The ring draws first (something on screen at the start), the wordmark lands with an overshoot, the tagline rises
0.75 s later in the caption band, under the ring (never inside it).

```html
<section class="scene r-logo" data-scene="logo">
  <svg class="lo-ring" width="600" height="600" viewBox="0 0 600 600"><circle cx="300" cy="300" r="280" pathLength="1"/></svg>
  <p class="lo-mark">Kora</p>
  <p class="lo-tag">Made to last</p>
</section>
```

```css
.lo-ring { left: 660px; top: 240px; }
.lo-ring circle { fill: none; stroke: var(--accent); stroke-width: 4; stroke-dasharray: 1; stroke-dashoffset: 1; transform: rotate(-90deg); transform-origin: 300px 300px; animation: draw-stroke 1s var(--draw) calc(var(--at) + 0.1s) both; }
.lo-mark { left: 460px; top: 435px; width: 1000px; text-align: center; font-family: var(--display); font-weight: 700; font-size: 200px; line-height: 1.05; letter-spacing: 4px; animation: pop 0.6s var(--pop) calc(var(--at) + 1.2s) both; }
.lo-tag { left: 460px; top: 850px; width: 1000px; text-align: center; font-size: 64px; letter-spacing: 2px; animation: rise 0.5s var(--arrive) calc(var(--at) + 1.95s) both; }
```

## Section break

`section-break`: a wipe between acts carrying one word. One accent bar sweeps across the frame, rests for 0.4 s with the word on it, and
sweeps out; it is one `transform` animation, so Edit converts it. Place it on the seam: `--at` is the next scene's start minus 0.6 s.
The word is in the headline band, in `--bg` on the accent.

```html
<section class="scene r-break" data-scene="break">
  <div class="sb-bar"><p class="sb-word">THEN</p></div>
</section>
```

```css
.sb-bar { left: 0; top: 380px; width: 1920px; height: 320px; background: var(--accent); animation: sweep 1.2s var(--travel) var(--at) both; }
.sb-word { position: absolute; margin: 0; left: 160px; top: 40px; width: 1400px; font-family: var(--display); font-weight: 700; font-size: 200px; line-height: 1.05; letter-spacing: 4px; color: var(--bg); }
@keyframes sweep {
  0% { transform: translateX(-1920px); animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1); }
  33% { transform: translateX(0); }
  66% { transform: translateX(0); animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1); }
  100% { transform: translateX(1920px); }
}
```

## Count-up (digit reel)

`big-number` and the `counter` generator: one headline figure that counts up, then holds (hold 1.5 s or more). It is a **digit reel**:
one column per digit, each column a strip `0 1 2 ... 9 0` behind an `overflow: hidden` window one line tall, moved with `translateY` to
the digit it stops on (`--d`; a zero stops on the strip's last 0, so `--d: 10`, which also makes it spin the whole way). The comma is a
static glyph between columns, so **thousands separators survive** (an `@property` counter cannot show one), the figure is exact in
Preview and Export, and Edit converts every column (it is plain `transform`). Layout is explicit px: a column is 0.62 x `--h` wide, a
separator 0.3 x `--h`, columns start `--i` x 0.1 s apart. For another number, add or remove columns and set each column's `--d` to its
digit (10 for 0) and `left` to the running width. Keep the label for after the figure lands (about 1.5 s).

```html
<section class="scene r-count" data-scene="count">
  <div class="count">
    <span class="col" style="left: 0px; --d: 1; --i: 0"><span class="reel">0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0</span></span>
    <span class="sep" style="left: 174px">,</span>
    <span class="col" style="left: 258px; --d: 2; --i: 1"><span class="reel">0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0</span></span>
    <span class="col" style="left: 432px; --d: 10; --i: 2"><span class="reel">0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0</span></span>
    <span class="col" style="left: 606px; --d: 10; --i: 3"><span class="reel">0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0</span></span>
  </div>
  <p class="sub n-label">units shipped</p>
</section>
```

```css
.count { --h: 280px; left: 570px; top: 240px; width: 780px; height: var(--h); font-family: var(--display); font-weight: 700; }
.count .col { position: absolute; top: 0; width: calc(var(--h) * 0.62); height: var(--h); overflow: hidden; }
.count .reel { position: absolute; left: 0; top: 0; width: 100%; text-align: center; font-size: calc(var(--h) * 0.86); line-height: var(--h); animation: reel 1.4s var(--arrive) calc(var(--at) + var(--i) * 0.1s) both; }
.count .sep { position: absolute; top: 0; width: calc(var(--h) * 0.3); text-align: center; font-size: calc(var(--h) * 0.86); line-height: var(--h); }
.n-label { left: 570px; top: 600px; width: 780px; animation: rise 0.6s var(--arrive) calc(var(--at) + 1.5s) both; }
@keyframes reel { from { transform: translateY(0); } to { transform: translateY(calc(var(--d) * var(--h) * -1)); } }
```

## Stat ring

`stat-ring`: one percentage. An SVG arc fills to the value while the figure inside counts up with the digit reel above (it needs that
recipe's `.count` CSS; this one only resizes it with `--h`). The `%` is a static glyph. The ring is the shared `draw-stroke` run
over a path that is already the right length: an SVG arc from the top, clockwise, through p x 360 degrees (p = 0.72 here), so it
ends at x = 280 + 250 sin(p x 360), y = 280 - 250 cos(p x 360) = (34.4, 326.9), with the large-arc flag 1 when p is over 0.5. A
dash shorter than the path or a keyframe set per value would make Edit sample it instead of reading it exactly.

```html
<section class="scene r-ring" data-scene="ring">
  <svg class="sr-svg" width="560" height="560" viewBox="0 0 560 560">
    <circle class="sr-base" cx="280" cy="280" r="250"/>
    <path class="sr-arc" d="M280 30 A250 250 0 1 1 34.4 326.9" pathLength="1"/>
  </svg>
  <div class="count sr-count">
    <span class="col" style="left: 0px; --d: 7; --i: 0"><span class="reel">0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0</span></span>
    <span class="col" style="left: 93px; --d: 2; --i: 1"><span class="reel">0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0</span></span>
    <span class="sep" style="left: 186px; width: 90px">%</span>
  </div>
  <p class="sub sr-label">of runs finish first try</p>
</section>
```

```css
.sr-svg { left: 360px; top: 260px; }
.sr-base { fill: none; stroke: var(--muted); stroke-width: 28; opacity: 0.25; }
.sr-arc { fill: none; stroke: var(--accent); stroke-width: 28; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw-stroke 1.4s var(--arrive) calc(var(--at) + 0.2s) both; }
.sr-count { --h: 150px; left: 502px; top: 465px; width: 276px; }
.sr-label { left: 1100px; top: 480px; width: 640px; animation: rise 0.6s var(--arrive) calc(var(--at) + 1.5s) both; }
```

## Stat bars

`stat-bars`: a comparison of 2-6 values. Bars grow from the baseline (`scaleY` from the bottom, 0.2 s apart in a calm piece), one bar in
the accent and the rest muted, values labelled directly above, no legend. Bar height in px = value / max x 440.

```html
<section class="scene r-bars" data-scene="bars">
  <span class="rule b-base"></span>
  <span class="bar" style="left: 580px; top: 509px; height: 311px; --i: 0"></span>
  <span class="bar" style="left: 860px; top: 451px; height: 369px; --i: 1"></span>
  <span class="bar hl" style="left: 1140px; top: 380px; height: 440px; --i: 2"></span>
  <p class="bval" style="left: 580px; top: 419px; --i: 0">48</p>
  <p class="bval" style="left: 860px; top: 361px; --i: 1">57</p>
  <p class="bval hl" style="left: 1140px; top: 290px; --i: 2">68</p>
  <p class="cap blab" style="left: 580px">2015</p>
  <p class="cap blab" style="left: 860px">2020</p>
  <p class="cap blab" style="left: 1140px">2025</p>
</section>
```

```css
.b-base { left: 480px; top: 820px; width: 960px; animation: draw-x 0.8s var(--draw) var(--at) both; }
.bar { width: 200px; background: var(--muted); transform-origin: center bottom; animation: grow 0.8s var(--arrive) calc(var(--at) + 0.3s + var(--i) * 0.2s) both; }
.bar.hl { background: var(--accent); }
.bval { width: 200px; text-align: center; font-family: var(--display); font-weight: 700; font-size: 64px; line-height: 1; animation: fade-in 0.4s var(--arrive) calc(var(--at) + 1.1s + var(--i) * 0.2s) both; }
.bval.hl { color: var(--accent); }
.blab { top: 850px; width: 200px; text-align: center; letter-spacing: 4px; animation: fade-in 0.4s var(--arrive) calc(var(--at) + 0.6s) both; }
@keyframes grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
```

## Icon row

`icon-row`: 3-7 capabilities as drawn icons, one highlighted. Inline SVG, a stroke style, a staggered rise 0.1 s apart. The three
shapes here (arrow, layers, spark) are abstract on purpose; draw the icon that says the specific thing, never a stock cliche.

```html
<section class="scene r-icons" data-scene="icons">
  <p class="cap i-tag">WHAT IT DOES</p>
  <div class="ir-item" style="left: 240px; --i: 0">
    <svg width="140" height="140" viewBox="0 0 24 24"><path d="M7 17L17 7 M8 7h9v9"/></svg>
    <p>Capture</p>
  </div>
  <div class="ir-item hl" style="left: 780px; --i: 1">
    <svg width="140" height="140" viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5"/></svg>
    <p>Arrange</p>
  </div>
  <div class="ir-item" style="left: 1320px; --i: 2">
    <svg width="140" height="140" viewBox="0 0 24 24"><path d="M12 3c.6 5 3 7.4 8 8-5 .6-7.4 3-8 8-.6-5-3-7.4-8-8 5-.6 7.4-3 8-8z"/></svg>
    <p>Share</p>
  </div>
</section>
```

```css
.i-tag { top: 250px; animation: fade-in 0.4s var(--arrive) calc(var(--at) + 0.1s) both; }
.ir-item { top: 400px; width: 360px; animation: rise 0.6s var(--arrive) calc(var(--at) + 0.3s + var(--i) * 0.1s) both; }
.ir-item svg { display: block; margin: 0 auto; fill: none; stroke: var(--ink); stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.ir-item.hl svg { stroke: var(--accent); }
.ir-item p { margin: 28px 0 0; text-align: center; font-size: 64px; line-height: 1.1; }
```

## Badge callouts

`badge-callouts`: 2-4 features with labels. A core shape on the left (draw the product's idea, never an invented screen), then one row
per feature: a numbered badge pops, a rule draws out of it, the label slides in; rows 0.5 s apart so each is named as it arrives.

```html
<section class="scene r-badges" data-scene="badges">
  <div class="bc-core"></div>
  <div class="bc-row" style="top: 300px; --i: 0"><span class="bc-badge">1</span><span class="bc-line"></span><p class="bc-label">Capture in one tap</p></div>
  <div class="bc-row" style="top: 480px; --i: 1"><span class="bc-badge">2</span><span class="bc-line"></span><p class="bc-label">Arrange by itself</p></div>
  <div class="bc-row" style="top: 660px; --i: 2"><span class="bc-badge">3</span><span class="bc-line"></span><p class="bc-label">Share anywhere</p></div>
</section>
```

```css
.bc-core { left: 180px; top: 260px; width: 560px; height: 560px; border-radius: 40px; background: var(--accent-soft); animation: rise 0.7s var(--settle) calc(var(--at) + 0.1s) both; }
.bc-row { left: 880px; width: 860px; height: 96px; }
.bc-row > * { position: absolute; margin: 0; }
.bc-badge { left: 0; top: 0; width: 92px; height: 92px; border: 3px solid var(--accent); border-radius: 50%; text-align: center; font-family: var(--display); font-weight: 700; font-size: 54px; line-height: 92px; animation: pop 0.45s var(--pop) calc(var(--at) + 0.5s + var(--i) * 0.5s) both; }
.bc-line { left: 112px; top: 46px; width: 100px; height: 2px; background: var(--muted); transform-origin: left center; animation: draw-x 0.4s var(--draw) calc(var(--at) + 0.7s + var(--i) * 0.5s) both; }
.bc-label { left: 232px; top: 14px; width: 620px; font-size: 64px; line-height: 1.1; animation: slide-x 0.5s var(--arrive) calc(var(--at) + 0.85s + var(--i) * 0.5s) both; }
```

## Chip cloud

`chip-cloud`: 3-8 tags or keywords (the pains of the old way, the ingredients). Pills pop in a loose cluster, 0.1 s apart; set the
positions by hand so no two touch. Filled chips use `--accent-soft`, outline chips a muted border.

```html
<section class="scene r-chips" data-scene="chips">
  <p class="chip" style="left: 300px; top: 330px; --i: 0">Slow exports</p>
  <p class="chip fill" style="left: 900px; top: 300px; --i: 1">Lost files</p>
  <p class="chip" style="left: 1320px; top: 420px; --i: 2">Version chaos</p>
  <p class="chip fill" style="left: 200px; top: 560px; --i: 3">Manual resizing</p>
  <p class="chip" style="left: 780px; top: 600px; --i: 4">Waiting</p>
  <p class="chip fill" style="left: 1180px; top: 700px; --i: 5">Rework</p>
</section>
```

```css
.chip { padding: 18px 40px; border: 2px solid var(--muted); border-radius: 999px; font-size: 54px; line-height: 1.1; white-space: nowrap; animation: pop 0.45s var(--pop) calc(var(--at) + 0.2s + var(--i) * 0.1s) both; }
.chip.fill { background: var(--accent-soft); border-color: var(--accent-soft); }
```

## Checklist

`checklist`: 2-6 steps checked off, the last one emphasised. Each row: a ring, a check that draws itself 0.35 s after the line rises,
rows 0.6 s apart.

```html
<section class="scene r-checks" data-scene="checks">
  <div class="cl-row" style="top: 330px; --i: 0">
    <svg width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="33"/><path d="M20 37 L31 48 L53 25" pathLength="1"/></svg>
    <p>Write the brief</p>
  </div>
  <div class="cl-row" style="top: 490px; --i: 1">
    <svg width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="33"/><path d="M20 37 L31 48 L53 25" pathLength="1"/></svg>
    <p>Check the beats</p>
  </div>
  <div class="cl-row last" style="top: 650px; --i: 2">
    <svg width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="33"/><path d="M20 37 L31 48 L53 25" pathLength="1"/></svg>
    <p>Publish</p>
  </div>
</section>
```

```css
.cl-row { left: 160px; width: 1400px; height: 96px; }
.cl-row > * { position: absolute; margin: 0; }
.cl-row svg { left: 0; top: 12px; fill: none; stroke: var(--muted); stroke-width: 3; }
.cl-row svg path { stroke: var(--ink); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw-stroke 0.5s var(--draw) calc(var(--at) + 0.65s + var(--i) * 0.6s) both; }
.cl-row p { left: 120px; top: 0; width: 1200px; font-size: 86px; line-height: 96px; animation: rise 0.6s var(--arrive) calc(var(--at) + 0.3s + var(--i) * 0.6s) both; }
.cl-row.last svg circle, .cl-row.last svg path { stroke: var(--accent); }
.cl-row.last p { color: var(--accent); }
```

## Comparison

`comparison`: before and after, us and them. Two glass cards: the left one muted (it fades to 0.55 so the eye goes right), the right one
with an accent border arriving 0.45 s later. The left card alone is the "old way" beat of a launch.

```html
<section class="scene r-compare" data-scene="compare">
  <div class="cmp-card old">
    <p class="cap cmp-cap">BEFORE</p>
    <p class="cmp-text">Hours of manual edits</p>
  </div>
  <div class="cmp-card new">
    <p class="cap cmp-cap">AFTER</p>
    <p class="cmp-text">One brief, one render</p>
  </div>
</section>
```

```css
.cmp-card { top: 270px; width: 760px; height: 520px; border: 2px solid var(--muted); border-radius: 28px; background: var(--surface); }
.cmp-card.old { left: 160px; animation: rise-dim 0.7s var(--settle) calc(var(--at) + 0.1s) both; }
.cmp-card.new { left: 1000px; border-color: var(--accent); animation: rise 0.7s var(--settle) calc(var(--at) + 0.55s) both; }
.cmp-card > * { position: absolute; margin: 0; }
.cmp-cap { left: 60px; top: 60px; width: 600px; }
.cmp-text { left: 60px; top: 190px; width: 640px; font-size: 86px; line-height: 1.1; }
.cmp-card.old .cmp-text { color: var(--muted); }
@keyframes rise-dim { from { opacity: 0; transform: translateY(40px); } to { opacity: 0.55; transform: none; } }
```

## Testimonial cards

`testimonial-cards`: social proof; only quotes and ratings the user supplied. Two cards (a third fits at 520 px wide), a star row
drawn as paths, the quote, the name; cards rise 0.15 s apart.

```html
<section class="scene r-proof" data-scene="proof">
  <div class="tc-card" style="left: 160px; --i: 0">
    <svg class="tc-stars" width="220" height="32" viewBox="0 0 220 32">
      <path d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
      <path transform="translate(46 0)" d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
      <path transform="translate(92 0)" d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
      <path transform="translate(138 0)" d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
      <path transform="translate(184 0)" d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
    </svg>
    <p class="tc-quote">The quote the client supplied</p>
    <p class="cap tc-name">NAME, ROLE</p>
  </div>
  <div class="tc-card" style="left: 1000px; --i: 1">
    <svg class="tc-stars" width="220" height="32" viewBox="0 0 220 32">
      <path d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
      <path transform="translate(46 0)" d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
      <path transform="translate(92 0)" d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
      <path transform="translate(138 0)" d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
      <path transform="translate(184 0)" d="M16 2 L19.3 11.5 L29.3 11.7 L21.3 17.7 L24.2 27.3 L16 21.6 L7.8 27.3 L10.7 17.7 L2.7 11.7 L12.7 11.5Z"/>
    </svg>
    <p class="tc-quote">A second supplied quote</p>
    <p class="cap tc-name">NAME, ROLE</p>
  </div>
</section>
```

```css
.tc-card { top: 270px; width: 760px; height: 520px; border: 1px solid var(--muted); border-radius: 28px; background: var(--surface); animation: rise 0.7s var(--settle) calc(var(--at) + 0.1s + var(--i) * 0.15s) both; }
.tc-card > * { position: absolute; margin: 0; }
.tc-stars { left: 60px; top: 60px; fill: var(--accent); }
.tc-quote { left: 60px; top: 140px; width: 640px; font-size: 64px; line-height: 1.15; }
.tc-name { left: 60px; top: 430px; width: 640px; font-size: 54px; }
```

## Parts snap into a layout

`arrange` system, and the "grow a diagram one part per beat" rule of `formats/explainer.md`: parts fly in from scattered offsets
(`--dx`, `--dy`, `--r` on each) and settle into a grid, 0.15 s apart; stretch the gap to 1-1.5 s and a diagram grows one named part at a
time. Opacity, translate and rotate only, so Edit converts it.

```html
<section class="scene r-arrange" data-scene="arrange">
  <p class="sub ar-text">One part at a time</p>
  <p class="ar-part" style="left: 960px; top: 300px; --dx: -420px; --dy: 120px; --r: -12deg; --i: 0">Input</p>
  <p class="ar-part hl" style="left: 1380px; top: 300px; --dx: 380px; --dy: -140px; --r: 10deg; --i: 1">Plan</p>
  <p class="ar-part" style="left: 960px; top: 580px; --dx: -300px; --dy: 260px; --r: 8deg; --i: 2">Render</p>
  <p class="ar-part" style="left: 1380px; top: 580px; --dx: 420px; --dy: 220px; --r: -9deg; --i: 3">Share</p>
</section>
```

```css
.ar-text { top: 440px; width: 700px; animation: rise 0.6s var(--arrive) calc(var(--at) + 0.2s) both; }
.ar-part { width: 380px; height: 240px; border: 2px solid var(--muted); border-radius: 28px; background: var(--surface); text-align: center; font-family: var(--display); font-weight: 700; font-size: 64px; line-height: 240px; animation: snap 0.8s var(--arrive) calc(var(--at) + 0.4s + var(--i) * 0.15s) both; }
.ar-part.hl { border-color: var(--accent); color: var(--accent); }
@keyframes snap { from { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--r)); } to { opacity: 1; transform: translate(0px, 0px) rotate(0deg); } }
```

## Steps that swap

`crossMorph` system and the numbered steps of `formats/explainer.md`: one ring, one number and one phrase stay in place while the
content swaps, each step's number and phrase rising in and the old ones lifting out (4 s a step). The last step rises in and stays. One
keyframe set carries the arrival, the hold and the exit, so nothing has two animations on one property.

```html
<section class="scene r-steps" data-scene="steps">
  <svg class="st-ring" width="220" height="220" viewBox="0 0 220 220"><circle cx="110" cy="110" r="100" pathLength="1"/></svg>
  <p class="st-num" style="--i: 0">1</p>
  <p class="st-num" style="--i: 1">2</p>
  <p class="st-num st-last" style="--i: 2">3</p>
  <p class="sub st-text" style="--i: 0">Write the brief</p>
  <p class="sub st-text" style="--i: 1">Check the beats</p>
  <p class="sub st-text st-last" style="--i: 2">Publish</p>
</section>
```

```css
.st-ring { left: 160px; top: 380px; }
.st-ring circle { fill: none; stroke: var(--accent); stroke-width: 4; stroke-dasharray: 1; stroke-dashoffset: 1; transform: rotate(-90deg); transform-origin: 110px 110px; animation: draw-stroke 0.8s var(--draw) calc(var(--at) + 0.1s) both; }
.st-num { left: 160px; top: 380px; width: 220px; text-align: center; font-family: var(--display); font-weight: 700; font-size: 120px; line-height: 220px; color: var(--accent); animation: swap 4s var(--exit) calc(var(--at) + 0.3s + var(--i) * 4s) both; }
.st-text { left: 460px; top: 430px; width: 1200px; animation: swap 4s var(--exit) calc(var(--at) + 0.3s + var(--i) * 4s) both; }
.st-last.st-num, .st-last.st-text { animation: rise 0.6s var(--arrive) calc(var(--at) + 0.3s + var(--i) * 4s) both; }
@keyframes swap {
  0% { opacity: 0; transform: translateY(40px); animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1); }
  12% { opacity: 1; transform: none; }
  88% { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translateY(-30px); }
}
```
