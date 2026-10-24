# Format: explainer

30-90 s (default 45). The viewer leaves understanding ONE idea through ONE concrete example worked from start to finish. Without a
voice-over the on-screen lines are the script: up to 10 words each, held 0.5 s + 0.3 s per word.

## Beat table (45 s; stretch the steps for longer)

| Beat | Seconds | Job | What fits |
| --- | --- | --- | --- |
| Hook | 0-5 | the question the viewer already has, in a familiar situation | `kinetic-title` (the question, `emphasis` on the key word), `typewriter-line` |
| Situation | 5-12 | the person or the problem, concretely: one example with real-looking specifics (never invented statistics) | `circled-phrase`, `quote-card` for a voice, raw icon + line |
| Idea | 12-22 | the device that answers the question enters INSIDE the situation: a diagram that grows one part per beat | `badge-callouts` (parts with labels), `stat-bars`, `comparison`, `arrange` system (parts snap into a layout) |
| Steps | 22-37 (3 x 5) | the same example run through each step; one numbered badge and one phrase per step, each morphing out of the last | `checklist`, raw numbered `circle` badges with `text`, `crossMorph` system, `slide` hand-off |
| Answer | 37-42 | back to the person: the example with its answer, in one picture | `big-number` or `stat-ring` if the answer is a number the user gave, otherwise a raw hero line |
| Close | 42-45 | the idea in one line; a brand end card only if asked | `kinetic-title`, or `logo-outro` when a name is given |

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
