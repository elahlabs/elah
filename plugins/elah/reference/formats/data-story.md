# Format: data story

20-45 s (default 30). Numbers are the plot. Use ONLY numbers the user gave; with none, do not invent any: write an explainer instead,
or ask once for the figures. Round them to what a viewer can say aloud.

## Beat table (30 s)

| Beat | Seconds | Job | What fits |
| --- | --- | --- | --- |
| Question | 0-4 | the question the numbers answer, frame 0 already on screen | `kinetic-title`, `typewriter-line`, raw hero text |
| The big number | 4-10 | the one headline figure, the largest element in the frame | `big-number` (variant `below`), or `counter` generator with a label |
| Context | 10-22 (2 x 6) | two comparisons: the thing against what a viewer knows | `stat-bars` (one bar `highlight`, the others muted), `stat-ring`, `comparison` |
| The turn | 22-27 | what it means, one sentence | `circled-phrase` (marker) around the key phrase, `kinetic-title` |
| Takeaway | 27-30 | one line (a source line, if the brief named one, is still on screen) | `quote-card`, raw hero line, `logo-outro` if a name is given (tagline as a raw line, see `components.md`) |

## Rules

- One number per 5-7 s, never two counting at once. A count-up runs 1.2-1.6 s with an overshoot, then holds at least 1.5 s so it can
  be read. The number lands, then its label arrives, then the context.
- At most two numbers on screen at once. Highlight one series in `$accent`, mute the others; never every bar in accent
  (`accent-overuse` fires past 35% of text elements).
- Build a chart in reading order: baseline and frame, then the data, then ONE annotation on the key value. Label the marks directly;
  no legends, no gridlines at full strength, no pie charts, no dashboard grid of KPI cards.
- A source line only when the brief names a source ("Source: <as the brief gave it>"). A team's own data, or no source named: no line,
  and never "provided by the client" or any invented attribution. When present it is small and quiet: the lowest type band (52 px
  landscape, 30 at 1080 wide), `muted`, left-aligned at the left margin (`x = 0.08 + maxWidth/2/W`), landscape y 0.92, vertical y 0.70
  (above the platform's caption zone). It appears just after the first number lands (its own `at`, 0.3-0.5 s into that beat, never
  tied to a beat's `at`; see `craft/motion.md`), lasts to the end of the piece, and sits clear of the hero and its label.
- Hold discipline: stillness for 0.3-0.75 s before the payoff number; zoom in on the one value that matters and let the rest fall away
  with a `camera` system (`push`) or a group scale key.
- Pace and energy: this format prefers calmer energy (long holds, one number at a time); the taste file sets the actual motion block.

The slice below shows structure under the minimal taste (its palette and motion block); another taste swaps those, not the beats.

```json
{
  "format": "elah-input", "version": 1, "title": "Data story slice",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Data story slice", "format": { "width": 1080, "height": 1920, "fps": 30 }, "duration": 10,
    "background": "$bg", "motion": { "energy": "standard", "camera": false, "ambient": "none", "transition": "crossfade" },
    "design": {
      "colors": [ { "name": "bg", "value": "#f7f7f5" }, { "name": "ink", "value": "#111111" }, { "name": "muted", "value": "#6b6b6b" },
        { "name": "accent", "value": "#15803d" }, { "name": "accentSoft", "value": "#bbf7d0" }, { "name": "surface", "value": "#ffffff" } ],
      "fonts": [ { "role": "sans", "font": "inter" }, { "role": "serif", "font": "playfair-display" } ]
    },
    "elements": [
      { "id": "b1", "kind": "component", "component": "big-number", "at": 0, "duration": 4, "items": [ { "value": 68, "text": "% of income goes to rent" } ] },
      { "id": "b2", "kind": "component", "component": "stat-bars", "at": 4, "duration": 6,
        "items": [ { "text": "2015", "value": 48 }, { "text": "2020", "value": 57 }, { "text": "2025", "value": 68, "style": "highlight" } ] },
      { "id": "src", "kind": "text", "at": 0.4, "duration": 9.6, "text": "Source: household survey, 2025", "font": "$sans", "size": 32, "color": "$muted",
        "align": "left", "maxWidth": 800, "x": 0.45, "y": 0.7, "enter": "fade-in" }
    ]
  } }
}
```
