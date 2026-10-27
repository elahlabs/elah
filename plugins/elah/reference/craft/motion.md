# Motion craft: how a piece should move

Every rule below is stated once in medium-neutral words, then written for each medium: **Programmatic** (HTML + CSS: `animation`
shorthand, `@keyframes`, `cubic-bezier()`, px of the stage; the CSS values and snippets are in `programmatic/motion.md`, which this
file does not repeat) and **VideoSpec** (presets, `enter` / `exit`, `reveal`, keys, fractions; curve, preset and reveal names are the
vocabulary's).

## Energy (the one place the multiplier is stated)

Numbers in this file and in `programmatic/motion.md` are seconds of the **standard recipe**. Energy scales that recipe once: `calm`
multiplies its durations and staggers by 1.3 (an arrival of 0.45 s becomes 0.6 s, a 0.08 s stagger 0.10 s), `bold` by 0.75. It never
touches a figure a taste file or a format table already gives as a calm or bold value: editorial's 0.2 s between movers and 0.8 s
rules, brutalist's 0.25-0.33 s arrivals and 0.2 s exits, the crossfade of dark-glass are final as written.

- Programmatic: you write the seconds yourself, so pick them once, from the standard recipe, for the taste's energy.
- VideoSpec: components and polish apply the multiplier themselves from `motion.energy`; apply it only to times you write by hand
  (keys, `at` offsets).

## The rules

1. **Everything arrives, everything leaves.** Nothing pops in or vanishes. Every element, scene and drawn stroke has an arrival and an
   exit chosen on purpose: arrival 0.45 s, exit 0.3 s; a chosen arrival beats a default.
   - Programmatic: every animation has a duration, a delay and `both`; a scene fades in and out on its section root, its parts arrive on
     their own children; the last scene arrives and holds (it never exits); a drawn stroke draws on (`stroke-dashoffset`), it does not
     pop.
   - VideoSpec: polish fills any gap you leave (0.45 s rise, 0.3 s exit), but give each hero its own `enter`, `reveal` or keys. The
     default for anything that is not text is a pop from 35% scale on `spring:bouncy` (70% on `spring:gentle` when `energy` is calm),
     and that includes **a whole beat group** and **a drawn stroke**: a raw beat `group` with no `enter` pops as one block, a `line` or
     `arc` with `draw` and no `enter` pops while it draws. So give every beat group `"enter": "fade-in"` (or `blur-in`,
     `slide-in-up`) and `"exit": "fade-out"`, and every drawn stroke `"enter": "fade-in"`. A component beat takes no `enter` (it is
     ignored) and pops at the start: use `energy: calm` when that is too bouncy for the taste.
2. **Exits are 30-50% shorter than arrivals** and ease in. A slow 0.8 s hero arrival gets a 0.4 s exit.
   - Programmatic: the exit curve of the table in `programmatic/motion.md`, a duration of 0.25-0.3 s (0.4 s for the slow hero).
   - VideoSpec: `quad-in`, `cubic-in`, `expo-in`; fade plus 4% shrink.
3. **Ease by role**, never linear on position, scale or rotation. Opacity, colour and size never bounce: springs and overshoot go on
   position and scale only.
   - Programmatic: a `cubic-bezier()` kept in a custom property per role; never `linear` on `transform` (a constant spin is the one
     exception); a curve with a y above 1 serves `transform` only.
   - VideoSpec: lint `linear-movement`; for constant spin use an expression `value + t * 0.5 * PI`, not keys.
4. **One hero per beat moves boldest and slowest;** support elements are smaller, faster and get out of the way. Once a title has
   landed, leave it alone and move something else.
   - Programmatic: no breathing, floating or pulsing loop on text; `infinite` only for a deliberate loop.
   - VideoSpec: the engine's idle float (6 px over 3.2 s) is the ceiling: add no other loops to text.
5. **One transition family** for the whole piece, one signature curve for about 90% of moves, one stagger value for grouped reveals.
   Mixing families is what makes a piece look assembled instead of directed.
   - Programmatic: the family is how the scene roots hand off (`programmatic/motion.md`, "Scenes and transitions").
   - VideoSpec: `motion.transition`.
6. **One wow moment** per piece (a word-hit run, a number landing, the logo burst). Everything else supports it.
7. **Nothing static for more than 1.5 s.** A held scene always has something slowly moving that is not the title.
   - Programmatic: the glow drift or the `.cam` push; the validator does not measure it, so check by reading.
   - VideoSpec: lint `static-hold`. Polish adds the float and a 4% camera push per beat, so holds survive as long as the elements are
     not completely bare.
8. **No empty frames.** Something is on screen at t = 0 (frame 0 is also the thumbnail) and until the last frame.
   - Programmatic: the hook takes a small negative delay (`-0.15s`) so it is part-way in at t = 0; the last animation ends by
     `durationSeconds` (validator warning otherwise); scene windows touch or overlap.
   - VideoSpec: a first element with `at: 0` and a last element ending at `spec.duration`, or the validator reports `hard-cut` for any
     gap over 0.05 s.

## Curves and springs by role

The roles and their seconds are the same in both media; the CSS curve for each is in `programmatic/motion.md` ("Curves by role").
VideoSpec names:

| Role | VideoSpec | Seconds |
| --- | --- | --- |
| Text and card arrival | `spring:snappy` on y, `cubic-out` on opacity (the polish default) | 0.45 |
| Pop (icon, badge, chip, dot) | `spring:bouncy` on scale from 0.35; calm pieces `spring:gentle` from 0.7 | 0.45 |
| Fast punch (word-hit, impact) | `expo-out`, `back-out` or `overshoot` | 0.25-0.4 |
| Travel across the frame | `cubic-in-out` or `smooth`; a move may cross at most a third of the frame without a mid key | 0.5-0.8 |
| Exit | `quad-in`, `cubic-in`, `expo-in`; fade plus 4% shrink | 0.25-0.3 |
| Drawn stroke (rule, ring, underline) | `draw` with `cubic-out`, a beat after the thing it points at lands | 0.5-0.9 |
| Count-up (`counter`, `big-number`) | one count, then a hold | 1.2-1.6, hold >= 1.5 |
| Camera push on a beat | `smooth` (polish: 4% over the beat); for a hero beat key `scale` 1 to 1.07 on the group yourself (polish then leaves it) | beat length |
| Colour or background change | `ease-in-out` | 0.4 |

Premium feel: gentle and snappy springs (`spring:gentle`, `spring:snappy`; in CSS the settle and expo-out curves); playful: the bouncy
spring; the wobbly spring only for deliberately comic. Corporate or financial content: no overshoot at all (`cubic-out`, a CSS curve
with no y above 1).

## Stagger, hand-offs, holds

- **Stagger:** words 0.07-0.12 s apart, characters 0.03 s, list rows and chips 0.07-0.10 s. The whole group should finish arriving
  inside 0.5 s; past that, shrink the step or reveal from the centre outward.
  - Programmatic: `style="--i: 2"` on each item and `animation-delay: calc(var(--at) + var(--i) * 0.08s)`.
  - VideoSpec: `reveal.stagger`. Siblings that share an `at` are spread by polish at 0.07 s per rank (x1.3 calm, x0.75 bold; lower `y`
    first, then lower `x`): the later ones start later and keep their duration. Inside a beat group that is the list stagger you want;
    write your own `at` offsets for a different order.
- **Hand-off:** inside a beat the next element starts when the previous is 30-50% through its arrival; between beats the outgoing
  one is still leaving as the next arrives.
  - Programmatic: the outgoing scene's `scene-out` and the incoming scene's `scene-in` share one delay (0.4 s, calm).
  - VideoSpec: write beats back to back (end == next start) so `motion.transition` applies, which extends the outgoing beat by 0.25 s
    and plays the hand-off. If a beat's first visible part arrives late (an `icon-row` shows its first icon 0.15-0.2 s in), the
    validator reports `hard-cut: empty frame for G s at T s`. Fix it with a real overlap: move only the late beat's `at` to at most
    `T - 0.05` (so it starts before the gap opens), or lengthen the outgoing beat by `G + 0.05`. Moving both beats together changes
    nothing, and "start it 0.15 s early" is not enough when the gap is wider. An overlapping seam gets no transition hand-off; that is
    fine for one seam.
- **Transitions:** the taste file sets the family; this is what each means. Crossfade is calm, a wipe (accent bar crosses at the
  boundary) is upbeat, zoom is a tech reveal, slide is step by step, a cut is brutalist or rhythmic. Use 3-5 hand-offs in a piece,
  hard cuts at most a third of the seams. In a VideoSpec `mask` is a crossfade by another name.
- **Reading hold:** every line stays on screen for 0.5 s + 0.3 s per word after it lands; the last line at least 2 s. Titles up to 6
  words; explainer lines up to 10. VideoSpec lint floor: 0.3 s + 0.29 s per word (`unreadable-hold`), so this always clears it.
- **Pace:** a visual change every 2-4 s on landscape, 1.5-3 s on vertical. Energy plan across the piece: calm open, build, peak,
  settled close; stillness before a payoff (0.3-0.75 s) makes the payoff land.

## VideoSpec only: compile length

The compiled piece ends at the latest element end after polish. A top-level element that ends exactly at the spec `duration` but
shares its `at` with another top-level element is moved later by the stagger step and ends after it: a source line `at` 4,
`duration` 26 in a 30 s calm spec tied with the beat at 4 ended at 30.09 s and the validator summary read 30.1 s. Hand-offs do not do
this: they extend the outgoing beat 0.25 s (x scale) into the next one, never past the last beat. The rule: every top-level `at` is
unique (offset a persistent element by 0.3-0.5 s and shorten its `duration` so `at + duration` still equals `duration`); inside a
group, shorten a tied child by the step if it must end with the group. Check: the summary's seconds equal your `duration`; if longer,
look for a tie (the note `staggered N siblings` lists none by name).

## VideoSpec only: sound

A programmatic video is silent. In a VideoSpec, `sfx` only on real hits (a landing, a reveal, an impact), at most eight, gain 0.2-0.4.
Bind each to an element with `on` (`{ "element": "b3-hero", "event": "arrive" }`) so it follows a retimed scene. Cues: `pop`, `click`,
`tick`, `whoosh`, `snap`, `impact`, `swoosh`, `chime`. A tick per list item or a pop per number is plenty; never a whoosh on every
cut. Silent is a valid choice.

## Camera and ambient

Each taste names a camera move and an ambient layer; choose them nowhere else (dark-glass: camera on, orbs; editorial: camera on,
grain; minimal: camera off, none; brutalist: camera off, grid).

- Programmatic: the camera is a `.cam` wrapper around the scenes pushing `scale(1)` to `scale(1.04)`; the ambient is one soft glow
  element drifting (or the flat ground for none).
- VideoSpec: `motion.camera: true` (default) pushes each top-level group 4% over its length. Ambient is a quiet layer under
  everything (`gradient` and `dots` are valid when the brief asks). For a harder move write a `camera` system on a group
  (`move: "push" | "pan" | "zoomOut" | "whip"`), once per beat at most.
