# Review: the self-review round before publishing

You cannot see frames, so review the numbers. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --notes "<work folder>/elah-input.json"`
and work through this list. The round is mandatory: do it after the first clean validation and before publishing, and it counts as
one of the three validation rounds.

## 1. Errors and warnings

Every error is fixed. Every warning is fixed or kept on purpose; a kept warning gets one line in your final note.

| Code | Engine rule | Fix |
| --- | --- | --- |
| `hard-cut` | an empty frame over 0.05 s anywhere, including t = 0 and the end | first element `at: 0`; beats touch or overlap; a mid-piece gap "G s at T s" closes only by starting the late beat at `T - 0.05` or earlier (or lengthening the one before by `G + 0.05`), not by moving both; last element reaches `duration`; for an end-of-piece gap shorten `duration` by the stated seconds (components run ~0.5 s past their own length) |
| `sparse-beat` | fewer than 3 parts visible for over 1 s (except one text of 120+ px) | add 2-3 raw companions spanning the beat (rule, label, dot, icon) or choose a richer component |
| `static-hold` | nothing moving for over 1.5 s | give the long-held element an `enter`, `reveal` or keys; check no beat is bare |
| `linear-movement` | `linear` curve on x, y, scale or rotation | `cubic-out`, `cubic-in-out`, `spring:snappy`; for constant spin write an expression |
| `off-scale-type` | `size` outside 30-38 / 48-64 / 96-140 (+-2) at 1080 wide | move to a band (`craft/type-and-layout.md`); a gap value such as 72 or 84 is always wrong |
| `accent-overuse` | over 35% of text elements in `$accent` | one accent element per beat; the rest `$ink` or `$muted` |
| `unreadable-hold` | on screen under 0.3 s + words / 3.5 | lengthen to 0.5 s + 0.3 s per word, or cut words |
| `off-margin` | text box crosses 6% / 94% | set `maxWidth`; left text: `x = margin + maxWidth / 2 / width` |
| `clamped` | a font weight the family lacks (a `checklist` always carries one: inter 500) | use a listed weight |
| `sfx-no-event` | a sound cue bound to an element with no arrival | bind to a part id (`<id>-wordmark`) or an element with `enter` |

Component-intrinsic warnings (listed in `components.md`) are not defects: keep them and say so once.

## 2. Read the polished notes

`--notes` prints what the engine filled in. They are information, not faults, but read them as feedback on how much you authored:

- `added arrivals to N elements` / `added exits to N elements`: those parts had no motion of yours. Fine for decoration; if heroes,
  beat groups or drawn strokes are in the count, give each its own `enter` or `reveal` (polish would pop them from 35% scale).
  Exits are added to nearly every part that has none (a count near the element total is normal).
- `staggered N siblings`: parts shared an `at`. Intended for a list inside a beat; at the top level it is a fault (the later element
  starts late and may end after `duration`): offset it yourself.
- The summary's seconds equal your `duration`. If longer (30.1 s for a 30 s spec), a top-level `at` is tied (`craft/motion.md`,
  Compile length): give the later element its own `at` and shorten its `duration` to match.
- `added idle float`, `camera push on N beats`, `ambient X layer`: the always-moving frame. Expected. No `ambient` note means you set
  `ambient: none` (fine for minimal, wrong for the others).
- `<transition> hand-off at N boundaries`: one per place two beats touched. Zero in a multi-beat piece means the beats do not touch
  (or the style is `cut`): check on purpose.

## 3. The beat sheet against the file

For each beat, read the JSON and answer yes or no; fix any no.

- One hero, named in one sentence? Everything else smaller and quieter?
- Does the sentence on screen read in `0.5 s + 0.3 s per word`, and does the last line hold 2 s?
- Hook in the first 2.5 s with something on screen at frame 0; product named in the first third; call to action held 1.5-3 s?
- Palette: all six tokens declared, text colours all from tokens, one accent on about a tenth of the frame?
- Fonts: at most two, all in the vocabulary, weights real?
- One transition family, one stagger step, one signature curve? Arrivals varied between beats?
- Every number, name and claim from the brief; no invented statistic, customer, screen, logo or URL; no `src` the user did not give?
- Beats with a component: raw parts outside its box (`components.md`, Regions)? A `logo-outro` has no `sub`, its tagline a raw line?
  A data story's source line only if the brief named a source?
- Ids unique and prefixed by beat (`b3-...`); every `layout.anchorTo`, `targets` and `sfx.on` id exists?
- Sound only on hits, at most eight cues, gain 0.2-0.4?
- Cut a third of the motion if a beat feels busy; keep the moves that lead the eye to the hero.
- Vertical: all text in y 0.10-0.72 (call to action may go lower on the last beat).

## 4. Final note to the user (3-5 lines)

What you chose (length, shape, format, taste, palette); what the validator said and which warnings you kept and why; what you could
not check (the artifact shows the real frames; audio cues are untested by ear); the weakest beat and the one change you would make next.
