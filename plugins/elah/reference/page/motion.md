# Page motion: the craft layer in CSS terms

Same rules as `craft/motion.md` and `craft/type-and-layout.md`, written as CSS you can paste. Numbers are seconds at standard energy;
calm (dark-glass, editorial) is x1.3, bold (brutalist) x0.75. Adapted in our own words from HeyGen HyperFrames' motion, story and
launch guidance (Apache-2.0, see `THIRD_PARTY_NOTICES.md`) and Elah's craft files; none of their script, GSAP or timing contract applies.

## Tokens (all six, as custom properties on `.stage`)

| Taste | `--bg` | `--ink` | `--muted` | `--accent` | `--accent-soft` | `--surface` |
| --- | --- | --- | --- | --- | --- | --- |
| dark-glass | #0b0f14 | #f4f6f8 | #8a94a3 | #5eead4 | #134e4a | #151b24 |
| editorial | #f4efe6 | #1b1a17 | #6f6a60 | #b3261e | #ecd0cb | #fffaf0 |
| brutalist | #0a0a0a | #f2f2ee | #8c8c85 | #c6f432 | #3a4a0c | #161616 |
| minimal | #f7f7f5 | #111111 | #6b6b6b | #15803d | #bbf7d0 | #ffffff |

Colours in rules are always `var(--token)`, never a hex; a brand colour in the brief replaces `--accent` (and `--accent-soft`, a deep
tint of it). The accent covers about a tenth of the frame (one word, one dot, one rule); no second glow colour; no hard black shadows
(`box-shadow: 0 24px 60px rgba(0,0,0,0.25)` at most). Fonts and type px per taste are in the taste file; write them as `font-family`,
`font-size`, `font-weight` (one display or serif + one sans).

## Curves by role (carry these as custom properties, one signature curve for about 90% of moves)

| Role | CSS | Engine name | Seconds |
| --- | --- | --- | --- |
| Hero and text arrival, long tail | `cubic-bezier(0.19, 1, 0.22, 1)` | expo-out, spring:stiff | 0.45 (hero 0.8-0.9) |
| Premium settle, no overshoot | `cubic-bezier(0.22, 1, 0.36, 1)` | spring:gentle | 0.5-0.6 |
| Snappy card or chip, 2% overshoot | `cubic-bezier(0.2, 1.25, 0.3, 1)` | spring:snappy | 0.45 |
| Bouncy pop, 10% overshoot, scale only | `cubic-bezier(0.34, 1.56, 0.64, 1)` from `scale(0.35)` | spring:bouncy, overshoot | 0.45 |
| Punch (word-hit, impact) | `cubic-bezier(0.175, 0.885, 0.32, 1.275)` | back-out | 0.25-0.4 |
| Travel, camera push, colour or background change | `cubic-bezier(0.65, 0, 0.35, 1)` | smooth, ease-in-out | 0.5-0.8; push = scene length |
| Exit | `cubic-bezier(0.55, 0.055, 0.675, 0.19)` or `cubic-bezier(0.7, 0, 0.84, 0)` | cubic-in, expo-in | 0.25-0.3 |
| Drawn stroke (rule, ring, underline, SVG path) | `cubic-bezier(0.215, 0.61, 0.355, 1)` | cubic-out | 0.5-0.9, a beat after its subject lands |

Rules: never `linear` on position, scale or rotation (a constant spin is the one exception); colour, blur and size
never overshoot, so a curve with a y above 1 serves `transform` (opacity is clamped at 1, so it is harmless there); corporate or financial content gets no overshoot at all. A `spring:wobbly` is a two-stage keyframe, written by hand:
`0% { transform: scale(0.35) } 55% { transform: scale(1.12) } 78% { transform: scale(0.97) } 100% { transform: scale(1) }` with
`animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1)` (applied between each pair of keyframes, not across the whole run).

## Arrivals, exits, holds

- Everything arrives and everything leaves. Arrival 0.45 s then exit 0.3 s; a slow 0.8 s hero gets a 0.4 s exit (exits are 30-50%
  shorter and ease in). Slow arrivals land more slowly than they leave; snappy arrivals read as glitches, so when in doubt lengthen.
- Move 24-60 px with the fade (`translateY(40px)`), never a full-frame fly-in; a travel across the frame is at most a third of it.
- One hero per scene moves boldest and slowest; supports are smaller, faster, and get out of the way. After a title lands it holds
  still: move something else (the glow, the camera). No breathing, floating or pulsing loops on text.
- Vary the hero entrance between scenes: `blur-in` (blur 12px to 0, 0.9 s), word-by-word fade, `rise` (translateY 40px to 0), `slide-x`
  (translateX -40px to 0), clip reveal (`clip-path: inset(0 100% 0 0)` to `inset(0)`, reported by Edit), draw-on stroke. Never one
  entrance on every element.
- Reading hold: a line stays 0.5 s + 0.3 s per word after it lands; the last line at least 2 s. Titles 6 words at most, explainer
  lines 10, no trailing period, no copy that starts "Introducing" or "Meet".
- Nothing static for more than 1.5 s: a held scene still has the slow glow drift or camera push (`scale(1)` to `scale(1.04)` over the
  scene, `cubic-bezier(0.65, 0, 0.35, 1)`; wrap the scenes in one `.cam` element for it).
- Stillness 0.3-0.75 s before the payoff (the number, the logo) makes it land; one wow moment per piece, everything else supports it.

## Stagger and overlap

- The next element starts when the previous one is 30-50% through its arrival. Words 0.07-0.12 s apart, characters 0.03 s, list rows
  and chips 0.07-0.10 s; the whole group finishes arriving inside 0.5 s (shrink the step, or start from the centre outward).
- Write the step once: `style="--i: 2"` on each item and `animation-delay: calc(var(--at) + var(--i) * 0.08s)` in the rule, with
  `--at` set on the scene or the item. Calm x1.3 (0.10 s), bold x0.75 (0.06 s).
- One stagger value for the whole piece; one moving thing at a time in calm tastes (0.2 s apart).

## Scenes and transitions

- Scene length 2-4 s landscape, 1.5-3 s vertical; a visible change every 2-4 s (1.5-3 s vertical). Hook inside 2.5 s, product named
  in the first third, last scene held 1.5-3 s. Scene times sum to `durationSeconds`.
- One transition family for the piece, 3-5 hand-offs, hard cuts at most a third of the seams. Crossfade: outgoing scene
  `scene-out 0.4s` and incoming `scene-in 0.4s` at the same delay (calm). Wipe: an accent bar `scaleX` 0 to 1 then 1 to 0 across
  the seam, 0.5 s. Zoom (tech reveal): outgoing `scale(1)` to `scale(1.15)` with opacity to 0, 0.4 s `cubic-in`; incoming from
  `scale(0.92)`, 0.5 s `expo-out`. Slide: outgoing translateX to -8%, incoming from +8%, 0.5 s `smooth`. Cut: delay = the boundary,
  no fade (brutalist). A transition has a cause on screen; worlds do not crossfade into each other for no reason.
- Rhythm: contrast speeds, calm open, build, peak, settled close; a hero scene gets the camera push, support scenes none.

## Draw-on and counters

- SVG path draw-on: `stroke-dasharray: 1; stroke-dashoffset: 1` on a `pathLength="1"` path, keyframes `to { stroke-dashoffset: 0 }`,
  0.8 s `cubic-bezier(0.215, 0.61, 0.355, 1)`, with `fill-opacity` arriving after. Converts to keys on Edit.
- A rule or bar: `transform: scaleX(0)` to `scaleX(1)` with `transform-origin: left center` (not `width`, which does not convert).
- A count-up: `@property --n { syntax: "<integer>"; inherits: false; initial-value: 0 }`, animate `--n` to the value over 1.2-1.6 s,
  show it with `counter-reset: n var(--n)` and `.num::after { content: counter(n) }`; hold at least 1.5 s. Edit reports it (custom
  property animation); preview and export are exact.

## Quiet taste mapping

dark-glass: calm, `cubic-bezier(0.22, 1, 0.36, 1)` and `0.19, 1, 0.22, 1`, blur-in headlines, crossfade or zoom, one soft
`radial-gradient` glow under 15% of the frame, a glass panel (`background: var(--surface)` at opacity 0.7, 1 px `var(--muted)` hairline,
radius 24-32, optional `backdrop-filter: blur(24px)`, one per scene). editorial: calm, serif at weight 400, one mover at a time 0.2 s
apart, rules drawn 0.8 s, crossfade. brutalist: bold, `cubic-bezier(0.19, 1, 0.22, 1)` at 0.25-0.33 s, hard cuts, a wipe at most
once per 4 s, hold the hit 1 s then cut, no italics. minimal: standard, 30-60 px `rise`, 0.2 s apart, short crossfade or cut, no
ambient, the flat ground is the texture.
