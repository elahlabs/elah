# Format: Words in motion (`kinetic-type`, words as the picture)

10-20 s (default 15). A statement, a manifesto, a quote, a lyric, a hype reel. The words are the design, so no separate captions.
Vertical suits it best; landscape works with raw text in the landscape bands.

## Beat table (15 s)

The last column is the programmatic video (the default medium); the column before it is the VideoSpec alternative.

| Beat | Seconds | Job | What fits (VideoSpec) | Programmatic recipe (`programmatic/recipes.md`) |
| --- | --- | --- | --- | --- |
| Open | 0-1 | the strongest word is on screen at frame 0 | `word-hits` first item, or raw hero text `pop-overshoot` / `punch-in` | [Word hits](../programmatic/recipes.md#word-hits) (first word, a small negative `--at` so it is in at frame 0), or a hero line with the `punch` curve |
| Phrases | 1-12 | one phrase of 2-6 words per 1.5-3 s, one idea per phrase; exits overlap the next arrival by 0.2 s | `word-hits` (3-8 words), `kinetic-title` (`emphasis` on the key word), `typewriter-line` for a quiet line, `circled-phrase` | [Word hits](../programmatic/recipes.md#word-hits) (3-8 words), [Kinetic title](../programmatic/recipes.md#kinetic-title) (the key word in the accent), [Typewriter line](../programmatic/recipes.md#typewriter-line) for a quiet line, [Circled phrase](../programmatic/recipes.md#circled-phrase) |
| Turn | one beat | a change of scale or tempo: one very short phrase after a longer one, or a `section-break` | `section-break`, `word-hits` with 2 items | [Section break](../programmatic/recipes.md#section-break), [Word hits](../programmatic/recipes.md#word-hits) with 2 words |
| Last phrase | final 2-3 s | the point, held at least 1.5 s | `kinetic-title` or raw hero text; `logo-outro` only if a name is given | [Kinetic title](../programmatic/recipes.md#kinetic-title) or a hero line; [Logo outro](../programmatic/recipes.md#logo-outro) only if a name is given |

## Rules

- One hero word per phrase, set in the headline band (96-140 px vertical, 172-248 landscape); the rest of the phrase one band down.
  Every word at one size reads as a list. Hero at y 0.40-0.48. Text never crosses the 6% margin; on vertical keep words in y 0.10-0.72.
- One accent word per phrase at most, and across the piece no more than a third of the text elements in accent.
- Tempo: stagger 0.07-0.12 s per word, arrivals 0.25-0.4 s, a phrase held for at least 0.6 s, long phrases 0.5 s + 0.3 s per word.
  Vary the arrival (`pop-overshoot`, `slide-in-up`, `blur-in`, `wipe-in`) and keep ONE hand-off family.
- Never three effects on one phrase. Linear easing never. A tick per word at gain 0.15-0.25 OR one hit per phrase, not both.
- A lone `word-hits` or `typewriter-line` beat is sparse (the validator reports `sparse-beat`): add two or three raw companions that
  span the beat, such as a drawn rule, a small mono counter like `01 / 04`, a dot. They are the grid, not decoration for its own sake.
- Taste, palette and motion block come from `director.md` and the taste file; this format only asks for the beat structure above.

The slice below shows structure under the brutalist taste (its palette and motion block); another taste swaps those, not the beats.

```json
{
  "format": "elah-input", "version": 1, "title": "Kinetic type slice",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Kinetic type slice", "format": { "width": 1080, "height": 1920, "fps": 30 }, "duration": 8,
    "background": "$bg", "motion": { "energy": "bold", "camera": false, "ambient": "grid", "transition": "cut" },
    "design": {
      "colors": [ { "name": "bg", "value": "#0a0a0a" }, { "name": "ink", "value": "#f2f2ee" }, { "name": "muted", "value": "#8c8c85" },
        { "name": "accent", "value": "#c6f432" }, { "name": "accentSoft", "value": "#3a4a0c" }, { "name": "surface", "value": "#161616" } ],
      "fonts": [ { "role": "display", "font": "anton" }, { "role": "mono", "font": "roboto-mono" } ]
    },
    "elements": [
      { "id": "b1", "kind": "component", "component": "word-hits", "at": 0, "duration": 4,
        "items": [ { "text": "MAKE" }, { "text": "EVERY" }, { "text": "SECOND" }, { "text": "COUNT", "style": "accent" } ] },
      { "id": "b1-rule", "kind": "shape", "shape": "line", "at": 0, "duration": 4, "w": 760, "h": 3, "stroke": "$muted", "strokeWidth": 3, "x": 0.5, "y": 0.72,
        "draw": { "duration": 0.5, "curve": "expo-out" }, "enter": "fade-in" },
      { "id": "b1-tag", "kind": "text", "at": 0.3, "duration": 3.7, "text": "01 / 02", "font": "$mono", "weight": 700, "size": 34, "color": "$muted",
        "align": "left", "maxWidth": 300, "x": 0.234, "y": 0.78, "letterSpacing": 4, "enter": "tracking-in" },
      { "id": "b2", "kind": "component", "component": "kinetic-title", "at": 4, "duration": 4, "text": "Words are the picture", "emphasis": ["picture"] }
    ]
  } }
}
```
