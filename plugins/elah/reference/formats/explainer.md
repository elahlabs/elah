# Format: explainer

30-90 s (default 45). The viewer leaves understanding ONE idea through ONE concrete example worked from start to finish. Without a
voice-over the on-screen lines are the script: up to 10 words each, held 0.5 s + 0.3 s per word.

## Beat table (45 s; stretch the steps for longer)

The last column is the programmatic video (the default medium); the column before it is the VideoSpec alternative.

| Beat | Seconds | Job | What fits (VideoSpec) | Programmatic recipe (`programmatic/recipes.md`) |
| --- | --- | --- | --- | --- |
| Hook | 0-5 | the question the viewer already has, in a familiar situation | `kinetic-title` (the question, `emphasis` on the key word), `typewriter-line` | [Kinetic title](../programmatic/recipes.md#kinetic-title) (the question, the key word in the accent), [Typewriter line](../programmatic/recipes.md#typewriter-line) |
| Situation | 5-12 | the person or the problem, concretely: one example with real-looking specifics (never invented statistics) | `circled-phrase`, `quote-card` for a voice, raw icon + line | [Circled phrase](../programmatic/recipes.md#circled-phrase), [Quote card](../programmatic/recipes.md#quote-card) for a voice, an inline SVG icon + line ([Icon row](../programmatic/recipes.md#icon-row) with one item) |
| Idea | 12-22 | the device that answers the question enters INSIDE the situation: a diagram that grows one part per beat | `badge-callouts` (parts with labels), `stat-bars`, `comparison`, `arrange` system (parts snap into a layout) | [Badge callouts](../programmatic/recipes.md#badge-callouts) (parts with labels), [Stat bars](../programmatic/recipes.md#stat-bars), [Comparison](../programmatic/recipes.md#comparison), [Parts snap into a layout](../programmatic/recipes.md#parts-snap-into-a-layout) (stretch the gap to grow the diagram one part per beat) |
| Steps | 22-37 (3 x 5) | the same example run through each step; one numbered badge and one phrase per step, each morphing out of the last | `checklist`, raw numbered `circle` badges with `text`, `crossMorph` system, `slide` hand-off | [Steps that swap](../programmatic/recipes.md#steps-that-swap) (one ring, number and phrase morphing step to step), [Checklist](../programmatic/recipes.md#checklist) |
| Answer | 37-42 | back to the person: the example with its answer, in one picture | `big-number` or `stat-ring` if the answer is a number the user gave, otherwise a raw hero line | [Count-up (digit reel)](../programmatic/recipes.md#count-up-digit-reel) or [Stat ring](../programmatic/recipes.md#stat-ring) if the answer is a number the user gave, otherwise a hero line |
| Close | 42-45 | the idea in one line; a brand end card only if asked | `kinetic-title`, or `logo-outro` when a name is given | [Kinetic title](../programmatic/recipes.md#kinetic-title), or [Logo outro](../programmatic/recipes.md#logo-outro) when a name is given |

## Rules

- One idea, one example. Pick the information shape first (a striking number, a myth corrected, before/after, ordered steps, a
  choice from many, a quote) and then the picture that fits it; give similar lines different pictures.
- Grow a diagram, never drop a finished one in: one part per beat as it is named; label each part directly on it (a short line or a
  `badge-callouts` elbow), never a legend, never bullet slides.
- Do not draw the same icon-in-a-circle for every step, do not show three equal cards in a row, do not read a line aloud and show it
  verbatim (with a voice-over, put the claim on screen, not the sentence).
- Every claim, value and step comes from the brief; label anything illustrative as such in the copy ("for example") and make no
  statistics up. If the brief lacks the facts for a step, write that step in general terms.
- Pace: a visual change every 3-4 s, so the steps read as a sequence; this format prefers calmer energy and never a frantic one.
  Taste, palette, ambient and the hand-off family come from `director.md` and the taste file.
- Landscape is the default; vertical for social. Split layouts in landscape (45% text, 55% diagram), a vertical stack otherwise.
  A component keeps its own region (`components.md`): in a split, the diagram is a component that honours `x`/`y`, on its side.
- End on one line stating the idea held 2 s, not on a fade to nothing.
